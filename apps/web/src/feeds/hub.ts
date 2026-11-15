import type { HubMessage, HubRequest, SourceState, SourceStatus } from './protocol';
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
}

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
export const STATUS_TICK_MS = 1000;

/** Exponential backoff with equal jitter: half the ceiling fixed, half random. */
export function backoffDelay(attempt: number, random: number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return ceiling / 2 + (random * ceiling) / 2;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
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
  status: SourceStatus;
}

interface Subscription {
  symbol: SymbolRef;
  channel: Channel;
  source: Source | null;
  count: number;
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
        status: {
          source: adapter.id,
          state: 'idle',
          lastEventAt: null,
          latencyMs: null,
          stale: false,
          attempt: 0,
          retryAt: null,
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
        this.subscribe(request.symbol, request.channel);
        break;
      case 'unsubscribe':
        this.unsubscribe(request.symbol, request.channel);
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
    }
  }

  dispose(): void {
    this.disposed = true;
    this.env.clearInterval(this.tickTimer);
    for (const source of this.sources) {
      if (source.retryTimer !== undefined) this.env.clearTimeout(source.retryTimer);
      source.generation += 1;
      source.adapter.dispose();
    }
  }

  private subscribe(symbol: SymbolRef, channel: Channel): void {
    const key = subscriptionKey(symbol, channel);
    const existing = this.subscriptions.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    const source = this.route(symbol);
    this.subscriptions.set(key, { symbol, channel, source, count: 1 });
    if (!source) {
      this.env.log('warn', `no feed supports ${symbol.id}`);
      return;
    }
    source.adapter.subscribe(symbol, channel);
    this.ensureRunning(source);
  }

  private unsubscribe(symbol: SymbolRef, channel: Channel): void {
    const key = subscriptionKey(symbol, channel);
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    subscription.count -= 1;
    if (subscription.count > 0) return;
    this.subscriptions.delete(key);
    const { source } = subscription;
    if (!source) return;
    source.adapter.unsubscribe(symbol, channel);
    if (!this.hasSubscriptions(source)) this.stop(source);
  }

  /** First source that supports the symbol and can run; else the first that supports it at all. */
  private route(symbol: SymbolRef): Source | null {
    const candidates = this.sources.filter((source) => source.adapter.supports(symbol));
    return candidates.find((source) => this.canRun(source)) ?? candidates[0] ?? null;
  }

  private canRun(source: Source): boolean {
    if (source.status.state === 'auth-failed') return false;
    return !source.needsKey || this.keys[source.id] !== undefined;
  }

  private hasSubscriptions(source: Source): boolean {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.source === source) return true;
    }
    return false;
  }

  private ensureRunning(source: Source): void {
    if (this.disposed || source.running || source.retryTimer !== undefined) return;
    if (!this.hasSubscriptions(source) || source.status.state === 'auth-failed') return;
    if (source.needsKey && this.keys[source.id] === undefined) {
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
      this.setState(source, 'auth-failed');
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
    const delay = backoffDelay(source.status.attempt, this.env.random());
    source.status.attempt += 1;
    source.status.retryAt = this.env.now() + delay;
    this.setState(source, 'reconnecting');
    source.retryTimer = this.env.setTimeout(() => {
      source.retryTimer = undefined;
      source.status.retryAt = null;
      this.ensureRunning(source);
    }, delay);
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
    source.status.retryAt = null;
    source.status.attempt = 0;
    source.status.stale = false;
    this.replaceAdapter(source);
    if (source.status.state !== 'auth-failed') this.setState(source, 'idle');
  }

  private setKeys(keys: Record<string, string>): void {
    const previous = this.keys;
    this.keys = { ...keys };
    for (const source of this.sources) {
      if (!source.needsKey || previous[source.id] === this.keys[source.id]) continue;
      // New or removed key: drop the current connection and start over with the new key.
      if (source.retryTimer !== undefined) this.env.clearTimeout(source.retryTimer);
      source.retryTimer = undefined;
      source.status.retryAt = null;
      source.status.attempt = 0;
      if (source.used) this.replaceAdapter(source);
      this.setState(source, 'idle');
      this.ensureRunning(source);
    }
  }

  private fetchHistory(
    requestId: number,
    symbol: SymbolRef,
    interval: BarInterval,
    from: number,
    to: number,
  ): void {
    const source = this.sources.find(
      (candidate) =>
        candidate.adapter.fetchHistory !== undefined &&
        candidate.adapter.supports(symbol) &&
        this.canRun(candidate),
    );
    const fetchHistory = source?.adapter.fetchHistory?.bind(source.adapter);
    if (!fetchHistory) {
      this.env.post({
        type: 'history-error',
        requestId,
        message: `No history source for ${symbol.id}`,
      });
      return;
    }
    fetchHistory(symbol, interval, from, to).then(
      (bars) => {
        if (!this.disposed) this.env.post({ type: 'history', requestId, bars });
      },
      (error: unknown) => {
        if (this.disposed) return;
        this.env.post({
          type: 'history-error',
          requestId,
          message: describeError(error),
        });
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
    if (event.channel !== 'bar') status.latencyMs = Math.max(0, event.receivedAt - event.ts);
    if (status.state !== 'live' || status.stale) {
      status.state = 'live';
      status.stale = false;
      status.attempt = 0;
      status.retryAt = null;
      this.markStatusDirty();
    }
    this.queue(event);
  }

  /** Trades and book updates are all kept; quotes and bars keep only the latest per frame. */
  private queue(event: FeedEvent): void {
    let key: string | null = null;
    if (event.channel === 'quote') key = `quote|${event.source}|${event.symbol}`;
    else if (event.channel === 'bar') {
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
      this.env.post({ type: 'status', sources: this.sources.map((s) => ({ ...s.status })) });
    }
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
