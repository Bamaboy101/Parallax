import type {
  AdapterContext,
  Bar,
  BarInterval,
  Channel,
  FeedAdapter,
  Level,
  SymbolRef,
} from '../types';
import { field, isObject, list, num, obj, parseFrame, str, time, type Json } from './parse';
import { INTERVAL_MS, getJson, throttle, tidy } from './rest';
import { SocketAdapter, browserSocket, type SocketFactory } from './socket';

const URL = 'wss://ws.kraken.com/v2';
const OHLC = 'https://api.kraken.com/0/public/OHLC';
/** Kraken's public REST counter allows about one call per second. */
const restQueue = throttle(1000);
/** Kraken returns at most the 720 most recent bars per interval. */
const OHLC_MINUTES: Record<BarInterval, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};
const CONTROL_GAP_MS = 150;
/** Kraken closes a connection after about a minute without traffic. */
const PING_MS = 30_000;
const BOOK_DEPTH = 25;

/**
 * Kraken's spot FX pairs, confirmed against the public AssetPairs endpoint on 16 Nov 2026.
 * Exchange prices, not interbank rates.
 */
export const KRAKEN_FX_PAIRS: ReadonlySet<string> = new Set([
  'AUD/JPY',
  'AUD/USD',
  'EUR/AUD',
  'EUR/CAD',
  'EUR/CHF',
  'EUR/GBP',
  'EUR/JPY',
  'EUR/USD',
  'GBP/USD',
  'USD/CAD',
  'USD/CHF',
  'USD/JPY',
]);

const UPSTREAM: Record<Channel, { channel: string; params: Json }> = {
  trade: { channel: 'trade', params: {} },
  quote: { channel: 'ticker', params: { event_trigger: 'bbo' } },
  book: { channel: 'book', params: { depth: BOOK_DEPTH } },
  bar: { channel: 'ohlc', params: { interval: 1 } },
};

const pairOf = (symbol: SymbolRef) => `${symbol.base}/${symbol.quote}`;

type Side = Map<number, number>;

/** Kraken spot v2. Crypto against USD and USDT, plus the spot FX pairs above. */
export class KrakenAdapter extends SocketAdapter implements FeedAdapter {
  readonly id = 'kraken';
  readonly needsKey = false;
  protected readonly url = URL;

  private readonly pairs = new Map<string, SymbolRef>();
  private readonly wanted = new Set<string>();
  private readonly toSubscribe = new Map<Channel, Set<string>>();
  private readonly toUnsubscribe = new Map<Channel, Set<string>>();
  private flushTimer: number | undefined;
  /** Local top-of-book per pair; Kraken expects clients to truncate to the subscribed depth. */
  private readonly books = new Map<string, { bids: Side; asks: Side }>();

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  /** OHLC from the public REST API: at most the 720 most recent bars of the interval. */
  async fetchHistory(
    symbol: SymbolRef,
    interval: BarInterval,
    from: number,
    to: number,
  ): Promise<Bar[]> {
    const since = Math.floor((from - INTERVAL_MS[interval]) / 1000);
    const url = `${OHLC}?pair=${encodeURIComponent(pairOf(symbol))}&interval=${String(OHLC_MINUTES[interval])}&since=${String(since)}`;
    const body = await restQueue(() => getJson(url));
    if (!isObject(body)) throw new Error('OHLC response is not an object');
    const errors = list(body, 'error');
    if (errors.length > 0) throw new Error(errors.map(String).join(', '));
    const result = obj(body, 'result');
    const key = Object.keys(result).find((name) => name !== 'last');
    const rows = key === undefined ? [] : list(result, key);
    const bars: Bar[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      // [time (s), open, high, low, close, vwap, volume, count]
      bars.push({
        ts: num(row[0]) * 1000,
        open: num(row[1]),
        high: num(row[2]),
        low: num(row[3]),
        close: num(row[4]),
        volume: num(row[6]),
      });
    }
    return tidy(bars, from, to);
  }

  supports(symbol: SymbolRef): boolean {
    if (symbol.kind === 'fx') return KRAKEN_FX_PAIRS.has(pairOf(symbol));
    return symbol.kind === 'crypto' && (symbol.quote === 'USD' || symbol.quote === 'USDT');
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    const pair = pairOf(symbol);
    this.pairs.set(pair, symbol);
    this.wanted.add(`${pair}|${channel}`);
    this.queue(this.toSubscribe, this.toUnsubscribe, channel, pair);
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
    const pair = pairOf(symbol);
    if (!this.wanted.delete(`${pair}|${channel}`)) return;
    if (channel === 'book') this.books.delete(pair);
    this.queue(this.toUnsubscribe, this.toSubscribe, channel, pair);
  }

  override dispose(): void {
    globalThis.clearTimeout(this.flushTimer);
    super.dispose();
  }

  protected onOpen(): void {
    this.keepAlive(PING_MS, { method: 'ping' });
    this.toSubscribe.clear();
    this.toUnsubscribe.clear();
    for (const key of this.wanted) {
      const [pair = '', channel = ''] = key.split('|');
      const pairs = this.toSubscribe.get(channel as Channel) ?? new Set<string>();
      pairs.add(pair);
      this.toSubscribe.set(channel as Channel, pairs);
    }
    this.flush();
  }

  private queue(
    into: Map<Channel, Set<string>>,
    cancel: Map<Channel, Set<string>>,
    channel: Channel,
    pair: string,
  ): void {
    if (cancel.get(channel)?.delete(pair)) return;
    const pairs = into.get(channel) ?? new Set<string>();
    pairs.add(pair);
    into.set(channel, pairs);
    if (this.flushTimer === undefined && this.isOpen) {
      this.flushTimer = globalThis.setTimeout(() => {
        this.flushTimer = undefined;
        this.flush();
      }, CONTROL_GAP_MS);
    }
  }

  private flush(): void {
    for (const [method, pending] of [
      ['unsubscribe', this.toUnsubscribe],
      ['subscribe', this.toSubscribe],
    ] as const) {
      for (const [channel, pairs] of pending) {
        if (pairs.size === 0) continue;
        const upstream = UPSTREAM[channel];
        this.send({
          method,
          params: { channel: upstream.channel, symbol: [...pairs], ...upstream.params },
        });
      }
      pending.clear();
    }
  }

  protected onMessage(text: string, receivedAt: number): void {
    const frame = parseFrame(text);
    if ('method' in frame) {
      if (frame.success === false) this.ctx.log('warn', `request rejected: ${String(frame.error)}`);
      return;
    }
    const channel = frame.channel;
    if (channel !== 'trade' && channel !== 'ticker' && channel !== 'book' && channel !== 'ohlc') {
      return; // heartbeat, status
    }
    const snapshot = str(frame, 'type') === 'snapshot';
    const entries = list(frame, 'data').filter(isObject);
    // The OHLC snapshot is recent history; only its last bar is the live one.
    const live = channel === 'ohlc' && snapshot ? entries.slice(-1) : entries;
    for (const data of live) this.handle(channel, snapshot, data, receivedAt);
  }

  private handle(
    channel: 'trade' | 'ticker' | 'book' | 'ohlc',
    snapshot: boolean,
    data: Json,
    receivedAt: number,
  ): void {
    const pair = str(data, 'symbol');
    const symbol = this.pairs.get(pair);
    if (!symbol) return;
    const base = { symbol: symbol.id, source: this.id, receivedAt };

    switch (channel) {
      case 'trade':
        if (!this.wanted.has(`${pair}|trade`)) return;
        this.ctx.emit({
          ...base,
          channel: 'trade',
          ts: time(data, 'timestamp'),
          price: field(data, 'price'),
          size: field(data, 'qty'),
        });
        break;
      case 'ticker':
        if (!this.wanted.has(`${pair}|quote`)) return;
        this.ctx.emit({
          ...base,
          channel: 'quote',
          ts: time(data, 'timestamp'),
          bid: field(data, 'bid'),
          bidSize: field(data, 'bid_qty'),
          ask: field(data, 'ask'),
          askSize: field(data, 'ask_qty'),
        });
        break;
      case 'book':
        if (!this.wanted.has(`${pair}|book`)) return;
        this.applyBook(pair, snapshot, data, base);
        break;
      case 'ohlc':
        if (!this.wanted.has(`${pair}|bar`)) return;
        this.ctx.emit({
          ...base,
          channel: 'bar',
          interval: '1m',
          ts: time(data, 'interval_begin'),
          open: field(data, 'open'),
          high: field(data, 'high'),
          low: field(data, 'low'),
          close: field(data, 'close'),
          volume: field(data, 'volume'),
        });
        break;
    }
  }

  /**
   * Apply a snapshot or update to the local book, truncate each side to BOOK_DEPTH, and emit the
   * change. Levels pushed out by truncation are emitted with size 0 so the store drops them too.
   */
  private applyBook(
    pair: string,
    snapshot: boolean,
    data: Json,
    base: { symbol: string; source: string; receivedAt: number },
  ): void {
    const ts = time(data, 'timestamp');
    let book = this.books.get(pair);
    if (snapshot || !book) {
      book = { bids: new Map(), asks: new Map() };
      this.books.set(pair, book);
    }
    const bids = applySide(book.bids, list(data, 'bids'), (a, b) => b - a);
    const asks = applySide(book.asks, list(data, 'asks'), (a, b) => a - b);
    if (snapshot) {
      this.ctx.emit({
        ...base,
        channel: 'book',
        ts,
        kind: 'snapshot',
        bids: sorted(book.bids, (a, b) => b - a),
        asks: sorted(book.asks, (a, b) => a - b),
      });
    } else {
      this.ctx.emit({ ...base, channel: 'book', ts, kind: 'delta', bids, asks });
    }
  }
}

/** Apply `[{price, qty}]` updates, truncate to depth, and return the changes including drops. */
function applySide(side: Side, updates: unknown[], order: (a: number, b: number) => number) {
  const changes: Level[] = [];
  for (const update of updates) {
    if (!isObject(update)) continue;
    const price = field(update, 'price');
    const qty = field(update, 'qty');
    if (qty === 0) side.delete(price);
    else side.set(price, qty);
    changes.push([price, qty]);
  }
  if (side.size > BOOK_DEPTH) {
    const prices = [...side.keys()].sort(order);
    for (const price of prices.slice(BOOK_DEPTH)) {
      side.delete(price);
      changes.push([price, 0]);
    }
  }
  return changes;
}

function sorted(side: Side, order: (a: number, b: number) => number): Level[] {
  return [...side.entries()].sort(([a], [b]) => order(a, b));
}
