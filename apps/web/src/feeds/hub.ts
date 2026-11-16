import type {
  HubMessage,
  HubRequest,
  RequestFailure,
  SourceState,
  SourceStatus,
  VerifyOutcome,
} from './protocol';
import { HttpError } from './adapters/rest';
import { routeOrder } from './router';
import {
  FeedAuthError,
  type AdapterContext,
  type AdapterRegistration,
  type BarInterval,
  type Channel,
  type FeedAdapter,
  type FeedEvent,
  type Logger,
  type SymbolRef,
} from './types';

/** Everything the hub needs from its host. The worker passes real timers; tests pass fakes. */
export interface HubEnv {
  now(): number;
  random(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(callback: () => void, ms: number): number;
  clearInterval(id: number): void;
  /** Run once at the next display frame. */
  nextFrame(callback: () => void): void;
  post(message: HubMessage): void;
  log: Logger;
  /** Exchange clock minus local clock, in ms, so latency survives a skewed local clock. */
  clockOffset(): number;
}

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
export const STATUS_TICK_MS = 1000;
/** Consecutive failed attempts before a source's subscriptions move to the next feed. */
export const FAILOVER_AFTER_ATTEMPTS = 3;
/** How long a failed-over source rests before it is tried again; doubles per repeat. */
export const DOWN_COOLDOWN_MS = 60_000;
export const DOWN_COOLDOWN_MAX_MS = 30 * 60_000;
/** A key check that has not answered by then is reported as failed. */
export const VERIFY_TIMEOUT_MS = 15_000;
/** A provider that answered 429 without Retry-After is left alone at least this long. */
export const RATE_LIMIT_WAIT_MS = 60_000;

/** Exponential backoff with equal jitter: half the ceiling fixed, half random. */
export function backoffDelay(attempt: number, random: number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return ceiling / 2 + (random * ceiling) / 2;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

const isRateLimit = (error: unknown): error is HttpError =>
  error instanceof HttpError && error.status === 429;

/** What a failed history or news request tells the app beyond its message. */
function requestFailure(error: unknown, now: number): RequestFailure | undefined {
  if (!isRateLimit(error)) return undefined;
  return {
    reason: 'rate-limited',
    retryAt: error.retryAfterMs === null ? null : now + error.retryAfterMs,
  };
}

interface Source {
  registration: AdapterRegistration;
  id: string;
  needsKey: boolean;
  adapter: FeedAdapter;
  /** Bumped whenever the adapter instance is replaced; callbacks from older instances are dropped. */
  generation: number;
  /** connect() has been called on the current instance. */
  used: boolean;
  /** A connect() call is in flight. */
  running: boolean;
  retryTimer: number | undefined;
  /** Pending end of a `down` period. */
  downTimer: number | undefined;
  /** Length of the next `down` period. */
  cooldownMs: number;
  status: SourceStatus;
}

interface Subscription {
  symbol: SymbolRef;
  channel: Channel;
  /** Feeds that can serve this subscription, in router order. */
  candidates: Source[];
  /** The feed currently serving it. Events from any other feed are dropped. */
  source: Source | null;
  count: number;
  /** How many of `count` are on screen. Visible subscriptions get capped stream slots first. */
  visible: number;
}

const subscriptionKey = (symbol: SymbolRef, channel: Channel) => `${symbol.id}|${channel}`;

/**
 * Owns every adapter: routes subscriptions, runs connections with reconnect and backoff, batches
 * events per frame and tracks status and age per source.
 */
export class FeedHub {
  private readonly sources: Source[];
  private readonly subscriptions = new Map<string, Subscription>();
  private keys: Record<string, string> = {};
  private pending: (FeedEvent | undefined)[] = [];
  /** Coalescing key → index in `pending` of the latest quote or bar. */
  private readonly latest = new Map<string, number>();
  private flushScheduled = false;
  private statusDirty = false;
  private readonly tickTimer: number;
  private disposed = false;

  constructor(
    registrations: AdapterRegistration[],
    private readonly env: HubEnv,
  ) {
    this.sources = registrations.map((registration) => {
      // Adapters only use their context after construction, so the source is resolved lazily.
      const ref: { current?: Source } = {};
      const adapter = registration.factory(this.contextFor(() => ref.current, 0));
      const source: Source = {
        registration,
        id: adapter.id,
        needsKey: adapter.needsKey,
        adapter,
        generation: 0,
        used: false,
        running: false,
        retryTimer: undefined,
        downTimer: undefined,
        cooldownMs: DOWN_COOLDOWN_MS,
        status: {
          source: adapter.id,
          state: 'idle',
          lastEventAt: null,
          latencyMs: null,
          stale: false,
          attempt: 0,
          retryAt: null,
          serving: [],
          symbolLimit: registration.symbolLimit ?? null,
          waiting: [],
          pollMs: registration.pollMs ?? null,
          key: adapter.needsKey ? (registration.key ?? adapter.id) : null,
          rateLimited: false,
        },
      };
      ref.current = source;
      return source;
    });
    this.tickTimer = env.setInterval(() => {
      this.tick();
    }, STATUS_TICK_MS);
  }

  handle(request: HubRequest): void {
    switch (request.type) {
      case 'subscribe':
        this.subscribe(request.symbol, request.channel, request.background === true);
        break;
      case 'unsubscribe':
        this.unsubscribe(request.symbol, request.channel, request.background === true);
        break;
      case 'keys':
        this.setKeys(request.keys);
        break;
      case 'history':
        this.fetchHistory(
          request.requestId,
          request.symbol,
          request.interval,
          request.from,
          request.to,
        );
        break;
      case 'news':
        this.fetchNews(request.requestId, request.symbol, request.from, request.to);
        break;
      case 'verify-key':
        this.verifyKey(request.requestId, request.provider, request.key);
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.env.clearInterval(this.tickTimer);
    for (const source of this.sources) {
      if (source.retryTimer !== undefined) this.env.clearTimeout(source.retryTimer);
      if (source.downTimer !== undefined) this.env.clearTimeout(source.downTimer);
      source.generation += 1;
      source.adapter.dispose();
    }
  }

  private subscribe(symbol: SymbolRef, channel: Channel, background: boolean): void {
    const key = subscriptionKey(symbol, channel);
    const existing = this.subscriptions.get(key);
    if (existing) {
      existing.count += 1;
      if (background) return;
      existing.visible += 1;
      // Coming on screen may claim a stream slot from a background subscription.
      if (existing.visible === 1) this.reassign();
      return;
    }
    const candidates = this.candidatesFor(symbol);
    this.subscriptions.set(key, {
      symbol,
      channel,
      candidates,
      source: null,
      count: 1,
      visible: background ? 0 : 1,
    });
    this.markStatusDirty();
    if (candidates.length === 0) {
      this.env.log('warn', `no feed supports ${symbol.id}`);
      return;
    }
    this.reassign();
  }

  private unsubscribe(symbol: SymbolRef, channel: Channel, background: boolean): void {
    const key = subscriptionKey(symbol, channel);
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    subscription.count -= 1;
    if (!background) subscription.visible = Math.max(0, subscription.visible - 1);
    if (subscription.count > 0) {
      // Gone off screen: a waiting visible subscription may take its slot.
      if (!background && subscription.visible === 0) this.reassign();
      return;
    }
    this.subscriptions.delete(key);
    this.markStatusDirty();
    const { source } = subscription;
    if (!source) return;
    source.adapter.unsubscribe(symbol, channel);
    if (!this.hasSubscriptions(source)) this.stop(source);
    // A capped feed may have room again for a waiting symbol.
    if (source.registration.symbolLimit !== undefined) this.reassign();
  }

  /** Registered feeds for a symbol in router order, then any other feed that supports it. */
  private candidatesFor(symbol: SymbolRef): Source[] {
    const supporting = this.sources.filter((source) => source.adapter.supports(symbol));
    const order = routeOrder(symbol);
    const ranked = order.flatMap((id) => supporting.filter((source) => source.id === id));
    return [...ranked, ...supporting.filter((source) => !order.includes(source.id))];
  }

  /** Symbols a source serves, across channels. */
  private symbolsOn(source: Source): Set<string> {
    const symbols = new Set<string>();
    for (const subscription of this.subscriptions.values()) {
      if (subscription.source === source) symbols.add(subscription.symbol.id);
    }
    return symbols;
  }

  /** The provider whose key a source uses: its own id unless the registration names another. */
  private keyOf(source: Source): string {
    return source.registration.key ?? source.id;
  }

  private canRun(source: Source): boolean {
    if (source.status.state === 'auth-failed') return false;
    return !source.needsKey || this.keys[this.keyOf(source)] !== undefined;
  }

  private usable(source: Source): boolean {
    return this.canRun(source) && source.status.state !== 'down';
  }

  /**
   * Place every subscription on its first usable feed with room, and move the ones whose place
   * changed. Visible subscriptions are placed first, so on a capped stream they take the slots
   * and background ones move on (to a poller, say) or wait. Placement is otherwise in
   * subscription order, so settled subscriptions do not churn. With no usable feed at all, a
   * subscription stays where it is, or goes to its first feed, which reports why (no key, down).
   */
  private reassign(): void {
    const taken = new Map<Source, Set<string>>();
    const fits = (source: Source, symbol: string) => {
      const limit = source.registration.symbolLimit;
      const symbols = taken.get(source);
      return limit === undefined || !symbols || symbols.has(symbol) || symbols.size < limit;
    };
    const ordered = [...this.subscriptions.values()].sort(
      (a, b) => Number(b.visible > 0) - Number(a.visible > 0),
    );
    const vacated = new Set<Source>();
    for (const subscription of ordered) {
      const { symbol, channel, candidates } = subscription;
      const usable = candidates.filter((candidate) => this.usable(candidate));
      const next =
        usable.length > 0
          ? (usable.find((candidate) => fits(candidate, symbol.id)) ?? null)
          : (subscription.source ?? candidates[0] ?? null);
      if (next) {
        const symbols = taken.get(next) ?? new Set<string>();
        symbols.add(symbol.id);
        taken.set(next, symbols);
      }
      const previous = subscription.source;
      if (next === previous) continue;
      subscription.source = next;
      this.markStatusDirty();
      if (previous) {
        previous.adapter.unsubscribe(symbol, channel);
        vacated.add(previous);
        this.env.log('info', `${symbol.id} ${channel}: ${previous.id} → ${next?.id ?? 'waiting'}`);
      }
      if (next) {
        next.adapter.subscribe(symbol, channel);
        this.ensureRunning(next);
      }
    }
    for (const source of vacated) {
      if (!this.hasSubscriptions(source)) this.stop(source);
    }
  }

  /** True when every subscription on the source has another usable feed to move to. */
  private canFailOver(source: Source): boolean {
    let any = false;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.source !== source) continue;
      any = true;
      const alternative = subscription.candidates.some(
        (candidate) => candidate !== source && this.usable(candidate),
      );
      if (!alternative) return false;
    }
    return any;
  }

  /** Rest a failing source, move its subscriptions away, and bring it back after a cooldown. */
  private markDown(source: Source): void {
    if (source.retryTimer !== undefined) this.env.clearTimeout(source.retryTimer);
    source.retryTimer = undefined;
    const cooldown = source.cooldownMs;
    source.cooldownMs = Math.min(cooldown * 2, DOWN_COOLDOWN_MAX_MS);
    source.status.retryAt = this.env.now() + cooldown;
    this.setState(source, 'down');
    this.env.log('warn', `${source.id} is down; failing over for ${String(cooldown / 1000)} s`);
    source.downTimer = this.env.setTimeout(() => {
      source.downTimer = undefined;
      source.status.retryAt = null;
      source.status.attempt = 0;
      this.setState(source, 'idle');
      this.reassign();
      this.ensureRunning(source);
    }, cooldown);
    this.reassign();
  }

  private hasSubscriptions(source: Source): boolean {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.source === source) return true;
    }
    return false;
  }

  private ensureRunning(source: Source): void {
    if (this.disposed || source.running || source.retryTimer !== undefined) return;
    if (!this.hasSubscriptions(source)) return;
    if (source.status.state === 'auth-failed' || source.status.state === 'down') return;
    if (source.needsKey && this.keys[this.keyOf(source)] === undefined) {
      this.setState(source, 'no-key');
      return;
    }
    if (source.used) this.replaceAdapter(source);
    source.used = true;
    source.running = true;
    const resumed = source.status.attempt > 0 || source.status.lastEventAt !== null;
    this.setState(source, resumed ? 'reconnecting' : 'connecting');

    const generation = source.generation;
    let connection: Promise<void>;
    try {
      connection = source.adapter.connect();
    } catch (error) {
      connection = Promise.reject(new Error(describeError(error)));
    }
    connection.then(
      () => {
        this.onConnectionEnd(source, generation, null);
      },
      (error: unknown) => {
        this.onConnectionEnd(source, generation, error);
      },
    );
  }

  private onConnectionEnd(source: Source, generation: number, error: unknown): void {
    if (this.disposed || generation !== source.generation) return;
    source.running = false;
    if (error instanceof FeedAuthError) {
      this.env.log('warn', `${source.id} rejected the key`);
      source.status.rateLimited = false;
      this.setState(source, 'auth-failed');
      this.reassign();
      return;
    }
    this.env.log(
      error ? 'warn' : 'info',
      error
        ? `${source.id} connection failed: ${describeError(error)}`
        : `${source.id} connection closed`,
    );
    if (!this.hasSubscriptions(source)) {
      this.setState(source, 'idle');
      return;
    }
    // A rate limit is not an outage: wait as long as the provider asked, at least.
    const limited = isRateLimit(error);
    source.status.rateLimited = limited;
    const backoff = backoffDelay(source.status.attempt, this.env.random());
    const delay = limited ? Math.max(backoff, error.retryAfterMs ?? RATE_LIMIT_WAIT_MS) : backoff;
    source.status.attempt += 1;
    source.status.retryAt = this.env.now() + delay;
    this.setState(source, 'reconnecting');
    source.retryTimer = this.env.setTimeout(() => {
      source.retryTimer = undefined;
      source.status.retryAt = null;
      this.ensureRunning(source);
    }, delay);
    if (source.status.attempt >= FAILOVER_AFTER_ATTEMPTS && this.canFailOver(source)) {
      this.markDown(source);
    }
  }

  /** Dispose the current instance and build a fresh one with every subscription replayed. */
  private replaceAdapter(source: Source): void {
    source.adapter.dispose();
    source.generation += 1;
    source.adapter = source.registration.factory(this.contextFor(() => source, source.generation));
    source.used = false;
    source.running = false;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.source === source) {
        source.adapter.subscribe(subscription.symbol, subscription.channel);
      }
    }
  }

  private stop(source: Source): void {
    if (source.retryTimer !== undefined) this.env.clearTimeout(source.retryTimer);
    source.retryTimer = undefined;
    source.status.stale = false;
    this.replaceAdapter(source);
    // A down or rejected source keeps its state so the badge can say why.
    if (source.status.state === 'down' || source.status.state === 'auth-failed') return;
    source.status.retryAt = null;
    source.status.attempt = 0;
    this.setState(source, 'idle');
  }

  private setKeys(keys: Record<string, string>): void {
    const previous = this.keys;
    this.keys = { ...keys };
    for (const source of this.sources) {
      const key = this.keyOf(source);
      if (!source.needsKey || previous[key] === this.keys[key]) continue;
      // New or removed key: drop the current connection and start over with the new key.
      if (source.retryTimer !== undefined) this.env.clearTimeout(source.retryTimer);
      source.retryTimer = undefined;
      source.status.retryAt = null;
      source.status.attempt = 0;
      if (source.used) this.replaceAdapter(source);
      this.setState(source, 'idle');
      this.ensureRunning(source);
    }
    this.reassign();
  }

  private fetchHistory(
    requestId: number,
    symbol: SymbolRef,
    interval: BarInterval,
    from: number,
    to: number,
  ): void {
    const source = this.candidatesFor(symbol).find(
      (candidate) => candidate.adapter.fetchHistory !== undefined && this.usable(candidate),
    );
    const fetchHistory = source?.adapter.fetchHistory?.bind(source.adapter);
    if (!fetchHistory) {
      this.env.post({
        type: 'history-error',
        requestId,
        message: `No history source for ${symbol.id}`,
        failure: { reason: 'no-source' },
      });
      return;
    }
    fetchHistory(symbol, interval, from, to).then(
      (bars) => {
        if (!this.disposed) this.env.post({ type: 'history', requestId, bars });
      },
      (error: unknown) => {
        if (this.disposed) return;
        const failure = requestFailure(error, this.env.now());
        this.env.post({
          type: 'history-error',
          requestId,
          message: describeError(error),
          ...(failure ? { failure } : {}),
        });
      },
    );
  }

  /** Company news from the first usable feed for the symbol that offers it. */
  private fetchNews(requestId: number, symbol: SymbolRef, from: number, to: number): void {
    const source = this.candidatesFor(symbol).find(
      (candidate) => candidate.adapter.fetchNews !== undefined && this.usable(candidate),
    );
    const fetchNews = source?.adapter.fetchNews?.bind(source.adapter);
    if (!source || !fetchNews) {
      this.env.post({
        type: 'news-error',
        requestId,
        message: `No news source for ${symbol.id}`,
        failure: { reason: 'no-source' },
      });
      return;
    }
    fetchNews(symbol, from, to).then(
      (items) => {
        if (!this.disposed) this.env.post({ type: 'news', requestId, items, source: source.id });
      },
      (error: unknown) => {
        if (this.disposed) return;
        const failure = requestFailure(error, this.env.now());
        this.env.post({
          type: 'news-error',
          requestId,
          message: describeError(error),
          ...(failure ? { failure } : {}),
        });
      },
    );
  }

  /**
   * Check a typed key on a throwaway adapter that sees only that key. The running source keeps
   * its own connection and its stored key until the user saves.
   */
  private verifyKey(requestId: number, provider: string, key: string): void {
    let settled = false;
    const settle = (outcome: VerifyOutcome) => {
      if (settled) return;
      settled = true;
      this.env.clearTimeout(timer);
      adapter?.dispose();
      if (!this.disposed) this.env.post({ type: 'verify-result', requestId, outcome });
    };
    const registration = this.sources.find((source) => source.id === provider)?.registration;
    const adapter = registration?.factory({
      emit: () => undefined,
      getKey: (name) => (name === provider ? key : undefined),
      log: (level, message) => {
        this.env.log(level, `${provider} key check: ${message}`);
      },
    });
    const timer = this.env.setTimeout(() => {
      settle({ result: 'failed', message: `${provider} did not answer in time` });
    }, VERIFY_TIMEOUT_MS);
    if (!adapter?.verifyKey) {
      settle({ result: 'failed', message: `No key test for ${provider}` });
      return;
    }
    adapter.verifyKey().then(
      () => {
        settle({ result: 'accepted' });
      },
      (error: unknown) => {
        settle(
          error instanceof FeedAuthError
            ? { result: 'rejected', message: describeError(error) }
            : { result: 'failed', message: describeError(error) },
        );
      },
    );
  }

  private contextFor(getSource: () => Source | undefined, generation: number): AdapterContext {
    return {
      emit: (event) => {
        const source = getSource();
        if (!source || this.disposed || generation !== source.generation) return;
        this.receive(source, event);
      },
      getKey: (provider) => this.keys[provider],
      log: (level, message) => {
        this.env.log(level, `${getSource()?.id ?? 'feed'}: ${message}`);
      },
    };
  }

  private receive(source: Source, event: FeedEvent): void {
    const status = source.status;
    status.lastEventAt = event.receivedAt;
    if (event.channel !== 'bar') {
      status.latencyMs = Math.max(0, event.receivedAt + this.env.clockOffset() - event.ts);
    }
    if (status.state !== 'live' || status.stale || status.rateLimited) {
      status.rateLimited = false;
      status.state = 'live';
      status.stale = false;
      status.attempt = 0;
      status.retryAt = null;
      source.cooldownMs = DOWN_COOLDOWN_MS;
      this.markStatusDirty();
    }
    // Only the feed serving a subscription reaches the store, so two feeds never mix.
    const subscription = this.subscriptions.get(`${event.symbol}|${event.channel}`);
    if (subscription?.source === source) this.queue(event);
  }

  /**
   * Trades, liquidations and book updates are all kept; quotes, perp funding and bars keep only
   * the latest per frame.
   */
  private queue(event: FeedEvent): void {
    let key: string | null = null;
    if (event.channel === 'quote' || event.channel === 'deriv') {
      key = `${event.channel}|${event.source}|${event.symbol}`;
    } else if (event.channel === 'bar') {
      key = `bar|${event.source}|${event.symbol}|${event.interval}|${String(event.ts)}`;
    }
    if (key !== null) {
      const previous = this.latest.get(key);
      if (previous !== undefined) this.pending[previous] = undefined;
      this.latest.set(key, this.pending.length);
    }
    this.pending.push(event);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.env.nextFrame(() => {
      this.flush();
    });
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.disposed) return;
    const events = this.pending.filter((event): event is FeedEvent => event !== undefined);
    this.pending = [];
    this.latest.clear();
    if (events.length > 0) this.env.post({ type: 'events', events });
    if (this.statusDirty) {
      this.statusDirty = false;
      this.env.post({ type: 'status', sources: this.sources.map((s) => this.statusOf(s)) });
    }
  }

  /** A source's status with the symbols it serves and its waiting list filled in. */
  private statusOf(source: Source): SourceStatus {
    const waiting = new Set<string>();
    for (const subscription of this.subscriptions.values()) {
      if (subscription.source !== null) continue;
      if (subscription.candidates.includes(source) && this.usable(source)) {
        waiting.add(subscription.symbol.id);
      }
    }
    return { ...source.status, serving: [...this.symbolsOn(source)], waiting: [...waiting] };
  }

  private setState(source: Source, state: SourceState): void {
    if (source.status.state === state) return;
    source.status.state = state;
    if (state !== 'live') source.status.stale = false;
    this.markStatusDirty();
  }

  private markStatusDirty(): void {
    this.statusDirty = true;
    this.scheduleFlush();
  }

  /** Once a second: update staleness, and refresh age and latency while anything is live. */
  private tick(): void {
    const now = this.env.now();
    let anyLive = false;
    for (const source of this.sources) {
      const status = source.status;
      if (status.state !== 'live' || status.lastEventAt === null) continue;
      anyLive = true;
      const { staleAfterMs, isActive } = source.registration.stale;
      const stale = (isActive?.(now) ?? true) && now - status.lastEventAt > staleAfterMs;
      if (stale !== status.stale) {
        status.stale = stale;
        if (stale) this.env.log('info', `${source.id} is stale`);
      }
    }
    if (anyLive) this.markStatusDirty();
  }
}
