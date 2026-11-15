import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MAX_MS,
  DOWN_COOLDOWN_MS,
  FAILOVER_AFTER_ATTEMPTS,
  FeedHub,
  STATUS_TICK_MS,
  backoffDelay,
  type HubEnv,
} from './hub';
import type { HubMessage, SourceStatus } from './protocol';
import {
  FeedAuthError,
  type AdapterContext,
  type AdapterRegistration,
  type Bar,
  type Channel,
  type FeedAdapter,
  type FeedEvent,
  type SymbolRef,
} from './types';

const BTC: SymbolRef = { id: 'BTC-USD', kind: 'crypto', base: 'BTC', quote: 'USD' };
const ETH: SymbolRef = { id: 'ETH-USD', kind: 'crypto', base: 'ETH', quote: 'USD' };
const AAPL: SymbolRef = { id: 'AAPL', kind: 'equity', base: 'AAPL', quote: 'USD' };
const FRAME_MS = 16;

/** One adapter instance: records calls and exposes its connection so tests can end it. */
class FakeAdapter implements FeedAdapter {
  readonly subscriptions = new Set<string>();
  connects = 0;
  disposed = false;
  history: ((symbol: SymbolRef) => Promise<Bar[]>) | undefined;
  private end: { resolve: () => void; reject: (error: unknown) => void } | undefined;

  constructor(
    readonly id: string,
    readonly needsKey: boolean,
    private readonly kinds: SymbolRef['kind'][],
    readonly ctx: AdapterContext,
  ) {}

  supports(symbol: SymbolRef) {
    return this.kinds.includes(symbol.kind);
  }
  subscribe(symbol: SymbolRef, channel: Channel) {
    this.subscriptions.add(`${symbol.id}|${channel}`);
  }
  unsubscribe(symbol: SymbolRef, channel: Channel) {
    this.subscriptions.delete(`${symbol.id}|${channel}`);
  }
  connect() {
    this.connects += 1;
    return new Promise<void>((resolve, reject) => {
      this.end = { resolve, reject };
    });
  }
  dispose() {
    this.disposed = true;
  }
  get fetchHistory() {
    const history = this.history;
    return history ? (symbol: SymbolRef) => history(symbol) : undefined;
  }
  fail(error: unknown = new Error('socket closed')) {
    this.end?.reject(error);
  }
  trade(symbol: string, price: number, ts: number, receivedAt = Date.now()) {
    this.ctx.emit({ channel: 'trade', symbol, price, size: 1, ts, receivedAt, source: this.id });
  }
}

function fakeFeed(id: string, kinds: SymbolRef['kind'][], options: { needsKey?: boolean } = {}) {
  const instances: FakeAdapter[] = [];
  const registration: AdapterRegistration = {
    factory: (ctx) => {
      const adapter = new FakeAdapter(id, options.needsKey ?? false, kinds, ctx);
      instances.push(adapter);
      return adapter;
    },
    stale: { staleAfterMs: 5000 },
  };
  const latest = () => {
    const adapter = instances.at(-1);
    if (!adapter) throw new Error(`${id} has no instance`);
    return adapter;
  };
  return { registration, instances, latest };
}

let messages: HubMessage[];
let hub: FeedHub | undefined;

function startHub(registrations: AdapterRegistration[]) {
  const env: HubEnv = {
    now: () => Date.now(),
    random: () => 0.5,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (id) => {
      window.clearTimeout(id);
    },
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (id) => {
      window.clearInterval(id);
    },
    nextFrame: (callback) => {
      window.setTimeout(callback, FRAME_MS);
    },
    post: (message) => messages.push(message),
    log: () => undefined,
    clockOffset: () => 0,
  };
  hub = new FeedHub(registrations, env);
  return hub;
}

const eventBatches = () =>
  messages.flatMap((message) => (message.type === 'events' ? [message.events] : []));

function lastStatus(source: string): SourceStatus | undefined {
  for (const message of [...messages].reverse()) {
    if (message.type !== 'status') continue;
    const status = message.sources.find((candidate) => candidate.source === source);
    if (status) return status;
  }
  return undefined;
}

/** Let settled promises run their callbacks, then advance fake time. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  messages = [];
});

afterEach(() => {
  hub?.dispose();
  hub = undefined;
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('doubles from 500 ms with jitter in the upper half, capped at 30 s', () => {
    expect(backoffDelay(0, 0)).toBe(250);
    expect(backoffDelay(0, 1)).toBe(500);
    expect(backoffDelay(3, 0.5)).toBe(3000);
    expect(backoffDelay(20, 1)).toBe(BACKOFF_MAX_MS);
  });
});

describe('FeedHub subscriptions', () => {
  it('connects on first subscribe and shares one upstream subscription between subscribers', async () => {
    const feed = fakeFeed('coinbase', ['crypto']);
    const hub = startHub([feed.registration]);

    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    expect(feed.latest().subscriptions).toEqual(new Set(['BTC-USD|trade']));
    expect(feed.latest().connects).toBe(1);

    hub.handle({ type: 'unsubscribe', symbol: BTC, channel: 'trade' });
    expect(feed.latest().subscriptions.size).toBe(1);

    hub.handle({ type: 'unsubscribe', symbol: BTC, channel: 'trade' });
    expect(feed.instances[0]?.disposed).toBe(true);
    await advance(FRAME_MS);
    expect(lastStatus('coinbase')?.state).toBe('idle');
  });

  it('routes each symbol to the first feed that supports it', () => {
    const crypto = fakeFeed('coinbase', ['crypto']);
    const stocks = fakeFeed('alpaca', ['equity']);
    const hub = startHub([crypto.registration, stocks.registration]);

    hub.handle({ type: 'subscribe', symbol: AAPL, channel: 'trade' });
    expect(stocks.latest().subscriptions).toEqual(new Set(['AAPL|trade']));
    expect(crypto.latest().connects).toBe(0);
  });
});

describe('FeedHub batching', () => {
  it('posts nothing until the frame, then every trade and only the latest quote', async () => {
    const feed = fakeFeed('coinbase', ['crypto']);
    const hub = startHub([feed.registration]);
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'quote' });
    const adapter = feed.latest();

    const quote = (bid: number): FeedEvent => ({
      channel: 'quote',
      symbol: 'BTC-USD',
      bid,
      bidSize: 1,
      ask: bid + 1,
      askSize: 1,
      ts: Date.now(),
      receivedAt: Date.now(),
      source: 'coinbase',
    });
    adapter.trade('BTC-USD', 100, Date.now());
    adapter.ctx.emit(quote(99));
    adapter.trade('BTC-USD', 101, Date.now());
    adapter.ctx.emit(quote(100));
    adapter.trade('BTC-USD', 102, Date.now());
    expect(eventBatches()).toHaveLength(0);

    await advance(FRAME_MS);
    const [batch] = eventBatches();
    expect(eventBatches()).toHaveLength(1);
    expect(
      batch?.map((event) => (event.channel === 'trade' ? event.price : event.channel)),
    ).toEqual([100, 101, 'quote', 102]);
    expect(batch?.find((event) => event.channel === 'quote')).toMatchObject({ bid: 100 });
  });

  it('keeps the final update of a bar that closed within the same frame', async () => {
    const feed = fakeFeed('coinbase', ['crypto']);
    const hub = startHub([feed.registration]);
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'bar' });
    const bar = (ts: number, close: number): FeedEvent => ({
      channel: 'bar',
      symbol: 'BTC-USD',
      interval: '1m',
      ts,
      open: 1,
      high: 1,
      low: 1,
      close,
      volume: 1,
      receivedAt: Date.now(),
      source: 'coinbase',
    });
    const adapter = feed.latest();
    adapter.ctx.emit(bar(0, 10));
    adapter.ctx.emit(bar(0, 11));
    adapter.ctx.emit(bar(60_000, 12));
    adapter.ctx.emit(bar(60_000, 13));

    await advance(FRAME_MS);
    expect(
      eventBatches()[0]?.map((event) => (event.channel === 'bar' ? [event.ts, event.close] : [])),
    ).toEqual([
      [0, 11],
      [60_000, 13],
    ]);
  });
});

describe('FeedHub reconnect', () => {
  it('retries with growing backoff on a fresh adapter that replays subscriptions', async () => {
    const feed = fakeFeed('coinbase', ['crypto']);
    const hub = startHub([feed.registration]);
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    hub.handle({ type: 'subscribe', symbol: ETH, channel: 'book' });

    feed.latest().fail();
    await advance(FRAME_MS);
    expect(lastStatus('coinbase')).toMatchObject({ state: 'reconnecting', attempt: 1 });
    expect(feed.instances).toHaveLength(1);

    await advance(backoffDelay(0, 0.5));
    expect(feed.instances).toHaveLength(2);
    expect(feed.instances[0]?.disposed).toBe(true);
    expect(feed.latest().subscriptions).toEqual(new Set(['BTC-USD|trade', 'ETH-USD|book']));
    expect(feed.latest().connects).toBe(1);

    feed.latest().fail();
    await advance(backoffDelay(1, 0.5) - 1);
    expect(feed.instances).toHaveLength(2);
    await advance(1);
    expect(feed.instances).toHaveLength(3);
  });

  it('goes live and resets the attempt count on the first message', async () => {
    const feed = fakeFeed('coinbase', ['crypto']);
    const hub = startHub([feed.registration]);
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    feed.latest().fail();
    await advance(backoffDelay(0, 0.5));

    feed.latest().trade('BTC-USD', 100, Date.now() - 140);
    await advance(FRAME_MS);
    expect(lastStatus('coinbase')).toMatchObject({ state: 'live', attempt: 0, latencyMs: 140 });
  });

  it('ignores events from an adapter instance it has replaced', async () => {
    const feed = fakeFeed('coinbase', ['crypto']);
    const hub = startHub([feed.registration]);
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    const first = feed.latest();
    first.fail();
    await advance(backoffDelay(0, 0.5));

    first.trade('BTC-USD', 1, Date.now());
    await advance(FRAME_MS);
    expect(eventBatches()).toHaveLength(0);
  });
});

describe('FeedHub keys', () => {
  it('waits in no-key until a key arrives, then connects with it', async () => {
    const feed = fakeFeed('alpaca', ['equity'], { needsKey: true });
    const hub = startHub([feed.registration]);
    hub.handle({ type: 'subscribe', symbol: AAPL, channel: 'trade' });
    await advance(FRAME_MS);
    expect(lastStatus('alpaca')?.state).toBe('no-key');
    expect(feed.latest().connects).toBe(0);

    hub.handle({ type: 'keys', keys: { alpaca: 'k1' } });
    expect(feed.latest().connects).toBe(1);
    expect(feed.latest().ctx.getKey('alpaca')).toBe('k1');
    expect(feed.latest().subscriptions).toEqual(new Set(['AAPL|trade']));
  });

  it('stops retrying when the key is rejected, and starts again with a new key', async () => {
    const feed = fakeFeed('alpaca', ['equity'], { needsKey: true });
    const hub = startHub([feed.registration]);
    hub.handle({ type: 'keys', keys: { alpaca: 'bad' } });
    hub.handle({ type: 'subscribe', symbol: AAPL, channel: 'trade' });

    feed.latest().fail(new FeedAuthError('unauthorized'));
    await advance(BACKOFF_MAX_MS * 2);
    expect(lastStatus('alpaca')?.state).toBe('auth-failed');
    expect(feed.instances).toHaveLength(1);

    hub.handle({ type: 'keys', keys: { alpaca: 'good' } });
    expect(feed.instances).toHaveLength(2);
    expect(feed.latest().connects).toBe(1);
  });
});

describe('FeedHub staleness', () => {
  it('marks a live source stale after its silence limit and clears it on the next message', async () => {
    const feed = fakeFeed('coinbase', ['crypto']);
    const hub = startHub([feed.registration]);
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    feed.latest().trade('BTC-USD', 100, Date.now());
    await advance(FRAME_MS);

    await advance(5000);
    expect(lastStatus('coinbase')?.stale).toBe(false);
    await advance(STATUS_TICK_MS + FRAME_MS);
    expect(lastStatus('coinbase')).toMatchObject({ state: 'live', stale: true });

    feed.latest().trade('BTC-USD', 101, Date.now());
    await advance(FRAME_MS);
    expect(lastStatus('coinbase')?.stale).toBe(false);
  });

  it('does not count silence while the source is outside its active hours', async () => {
    const feed = fakeFeed('alpaca', ['equity']);
    feed.registration.stale = { staleAfterMs: 30_000, isActive: () => false };
    const hub = startHub([feed.registration]);
    hub.handle({ type: 'subscribe', symbol: AAPL, channel: 'trade' });
    feed.latest().trade('AAPL', 190, Date.now());

    await advance(120_000);
    expect(lastStatus('alpaca')).toMatchObject({ state: 'live', stale: false });
  });
});

describe('FeedHub history', () => {
  it('answers from a feed with history, and reports an error when none can serve it', async () => {
    const feed = fakeFeed('coinbase', ['crypto']);
    const hub = startHub([feed.registration]);
    const bars: Bar[] = [{ ts: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }];
    feed.latest().history = () => Promise.resolve(bars);

    hub.handle({ type: 'history', requestId: 7, symbol: BTC, interval: '1m', from: 0, to: 60_000 });
    hub.handle({
      type: 'history',
      requestId: 8,
      symbol: AAPL,
      interval: '1m',
      from: 0,
      to: 60_000,
    });
    await advance(0);

    expect(messages).toContainEqual({ type: 'history', requestId: 7, bars });
    expect(messages).toContainEqual({
      type: 'history-error',
      requestId: 8,
      message: 'No history source for AAPL',
    });
  });
});

describe('FeedHub failover', () => {
  /** Fail the current connection `times` times, waiting out each backoff in between. */
  async function failRepeatedly(feed: ReturnType<typeof fakeFeed>, times: number) {
    for (let attempt = 0; attempt < times; attempt += 1) {
      feed.latest().fail();
      await advance(0);
      if (attempt < times - 1) await advance(backoffDelay(attempt, 0.5));
    }
  }

  it('moves subscriptions to the next feed after repeated failures, and back after a cooldown', async () => {
    const coinbase = fakeFeed('coinbase', ['crypto']);
    const kraken = fakeFeed('kraken', ['crypto']);
    const hub = startHub([kraken.registration, coinbase.registration]);
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    // Router order wins over registration order.
    expect(coinbase.latest().subscriptions).toEqual(new Set(['BTC-USD|trade']));
    expect(kraken.latest().connects).toBe(0);

    await failRepeatedly(coinbase, FAILOVER_AFTER_ATTEMPTS);
    await advance(FRAME_MS);
    expect(lastStatus('coinbase')).toMatchObject({ state: 'down' });
    expect(kraken.latest().subscriptions).toEqual(new Set(['BTC-USD|trade']));
    expect(kraken.latest().connects).toBe(1);

    await advance(DOWN_COOLDOWN_MS);
    expect(coinbase.latest().subscriptions).toEqual(new Set(['BTC-USD|trade']));
    expect(coinbase.latest().connects).toBe(1);
    expect(kraken.instances.at(-2)?.disposed).toBe(true);
  });

  it('forwards events only from the feed serving the subscription', async () => {
    const coinbase = fakeFeed('coinbase', ['crypto']);
    const kraken = fakeFeed('kraken', ['crypto']);
    const hub = startHub([coinbase.registration, kraken.registration]);
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    const failing = coinbase.latest();
    await failRepeatedly(coinbase, FAILOVER_AFTER_ATTEMPTS);

    kraken.latest().trade('BTC-USD', 200, Date.now());
    failing.trade('BTC-USD', 100, Date.now());
    await advance(FRAME_MS);
    const prices = eventBatches()
      .flat()
      .map((event) => (event.channel === 'trade' ? event.price : null));
    expect(prices).toEqual([200]);
  });

  it('keeps retrying when no other feed can serve the symbol', async () => {
    const coinbase = fakeFeed('coinbase', ['crypto']);
    const hub = startHub([coinbase.registration]);
    hub.handle({ type: 'subscribe', symbol: BTC, channel: 'trade' });
    await failRepeatedly(coinbase, FAILOVER_AFTER_ATTEMPTS + 1);
    await advance(FRAME_MS);
    expect(lastStatus('coinbase')?.state).toBe('reconnecting');
  });
});
