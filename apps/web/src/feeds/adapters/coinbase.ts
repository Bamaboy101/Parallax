import {
  INTERVAL_MS,
  type AdapterContext,
  type Bar,
  type BarInterval,
  isMarketChannel,
  type Channel,
  type MarketChannel,
  type FeedAdapter,
  type SymbolRef,
} from '../types';
import { MinuteBars } from './bars';
import { field, levels, list, num, parseFrame, str, time, type Json } from './parse';
import { aggregate, getJson, throttle, tidy } from './rest';
import { SocketAdapter, browserSocket, type SocketFactory } from './socket';

const URL = 'wss://ws-feed.exchange.coinbase.com';
const REST = 'https://api.exchange.coinbase.com';
/** Coinbase serves at most 300 candles per request. */
const CANDLE_LIMIT = 300;
const MAX_PAGES = 5;
/** Public REST allows about 10 requests per second per IP. */
const restQueue = throttle(150);
/** Supported granularities; 4h is built from 1h candles. */
const GRANULARITY: Record<BarInterval, BarInterval> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '1h',
  '1d': '1d',
};
/** Coinbase allows about 8 requests per second per IP; batch changes into one frame per gap. */
const CONTROL_GAP_MS = 150;

/**
 * Upstream channel per app channel. `level2` needs authentication; `level2_batch` is the keyless
 * equivalent, batched every 50 ms. Coinbase has no candle channel, so 1-minute bars are built
 * from matches.
 */
const UPSTREAM: Record<MarketChannel, string> = {
  trade: 'matches',
  bar: 'matches',
  quote: 'ticker',
  book: 'level2_batch',
};

const productId = (symbol: SymbolRef) => `${symbol.base}-${symbol.quote}`;

/** Coinbase Exchange. USD pairs: trades, best bid/ask, full L2 book and 1-minute bars. */
export class CoinbaseAdapter extends SocketAdapter implements FeedAdapter {
  readonly id = 'coinbase';
  readonly needsKey = false;
  protected readonly url = URL;

  private readonly products = new Map<string, SymbolRef>();
  /** `${productId}|${channel}` for every app subscription. */
  private readonly wanted = new Set<string>();
  /** Upstream channel → products to add or remove at the next flush. */
  private readonly toSubscribe = new Map<string, Set<string>>();
  private readonly toUnsubscribe = new Map<string, Set<string>>();
  private flushTimer: number | undefined;
  private readonly bars = new MinuteBars();

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  /** Candles from the public REST API, newest pages first, up to 1,500 per request. */
  async fetchHistory(
    symbol: SymbolRef,
    interval: BarInterval,
    from: number,
    to: number,
  ): Promise<Bar[]> {
    const step = INTERVAL_MS[GRANULARITY[interval]];
    const pageMs = CANDLE_LIMIT * step;
    const bars: Bar[] = [];
    let end = to;
    for (let page = 0; page < MAX_PAGES && end > from; page += 1) {
      const start = Math.max(from, end - pageMs);
      const url = `${REST}/products/${productId(symbol)}/candles?granularity=${String(step / 1000)}&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`;
      const rows = await restQueue(() => getJson(url));
      if (!Array.isArray(rows)) throw new Error('candles response is not a list');
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        // [time (s), low, high, open, close, volume]
        bars.push({
          ts: num(row[0]) * 1000,
          low: num(row[1]),
          high: num(row[2]),
          open: num(row[3]),
          close: num(row[4]),
          volume: num(row[5]),
        });
      }
      end = start - step;
    }
    const ordered = tidy(bars, from, to);
    return interval === '4h' ? aggregate(ordered, INTERVAL_MS['4h']) : ordered;
  }

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'crypto' && symbol.quote === 'USD';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    if (!isMarketChannel(channel)) return;
    const product = productId(symbol);
    this.products.set(product, symbol);
    const upstream = UPSTREAM[channel];
    const already = this.needsUpstream(product, upstream);
    this.wanted.add(`${product}|${channel}`);
    if (!already) this.queue(this.toSubscribe, this.toUnsubscribe, upstream, product);
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
    if (!isMarketChannel(channel)) return;
    const product = productId(symbol);
    if (!this.wanted.delete(`${product}|${channel}`)) return;
    if (channel === 'bar') this.bars.delete(product);
    const upstream = UPSTREAM[channel];
    if (!this.needsUpstream(product, upstream)) {
      this.queue(this.toUnsubscribe, this.toSubscribe, upstream, product);
    }
  }

  override dispose(): void {
    globalThis.clearTimeout(this.flushTimer);
    super.dispose();
  }

  protected onOpen(): void {
    this.toSubscribe.clear();
    this.toUnsubscribe.clear();
    for (const key of this.wanted) {
      const [product = '', channel = ''] = key.split('|');
      const upstream = UPSTREAM[channel as MarketChannel];
      const products = this.toSubscribe.get(upstream) ?? new Set<string>();
      products.add(product);
      this.toSubscribe.set(upstream, products);
    }
    this.flush();
  }

  private needsUpstream(product: string, upstream: string): boolean {
    return (Object.keys(UPSTREAM) as MarketChannel[]).some(
      (channel) => UPSTREAM[channel] === upstream && this.wanted.has(`${product}|${channel}`),
    );
  }

  private queue(
    into: Map<string, Set<string>>,
    cancel: Map<string, Set<string>>,
    upstream: string,
    product: string,
  ): void {
    if (cancel.get(upstream)?.delete(product)) return; // the opposite change was still pending
    const products = into.get(upstream) ?? new Set<string>();
    products.add(product);
    into.set(upstream, products);
    if (this.flushTimer === undefined && this.isOpen) {
      this.flushTimer = globalThis.setTimeout(() => {
        this.flushTimer = undefined;
        this.flush();
      }, CONTROL_GAP_MS);
    }
  }

  private flush(): void {
    for (const [type, pending] of [
      ['unsubscribe', this.toUnsubscribe],
      ['subscribe', this.toSubscribe],
    ] as const) {
      const channels = [...pending]
        .filter(([, products]) => products.size > 0)
        .map(([name, products]) => ({ name, product_ids: [...products] }));
      pending.clear();
      if (channels.length > 0) this.send({ type, channels });
    }
  }

  private has(product: string, channel: Channel): boolean {
    return this.wanted.has(`${product}|${channel}`);
  }

  protected onMessage(text: string, receivedAt: number): void {
    const frame = parseFrame(text);
    const type = str(frame, 'type');
    if (type === 'error') {
      this.ctx.log('warn', `${String(frame.message)}: ${String(frame.reason)}`);
      return;
    }
    if (!['match', 'ticker', 'snapshot', 'l2update'].includes(type)) return;
    const product = str(frame, 'product_id');
    const symbol = this.products.get(product);
    if (!symbol) return;
    const base = { symbol: symbol.id, source: this.id, receivedAt };

    switch (type) {
      case 'match': {
        const ts = time(frame, 'time');
        const price = field(frame, 'price');
        const size = field(frame, 'size');
        if (this.has(product, 'trade')) {
          this.ctx.emit({ ...base, channel: 'trade', ts, price, size });
        }
        if (this.has(product, 'bar')) this.updateBar(product, base, ts, price, size);
        break;
      }
      case 'ticker':
        if (!this.has(product, 'quote')) return;
        this.ctx.emit({
          ...base,
          channel: 'quote',
          ts: time(frame, 'time'),
          bid: field(frame, 'best_bid'),
          bidSize: field(frame, 'best_bid_size'),
          ask: field(frame, 'best_ask'),
          askSize: field(frame, 'best_ask_size'),
        });
        break;
      case 'snapshot':
        if (!this.has(product, 'book')) return;
        this.ctx.emit({
          ...base,
          channel: 'book',
          ts: typeof frame.time === 'string' ? time(frame, 'time') : receivedAt,
          kind: 'snapshot',
          bids: levels(list(frame, 'bids')),
          asks: levels(list(frame, 'asks')),
        });
        break;
      case 'l2update':
        if (!this.has(product, 'book')) return;
        this.emitBookDelta(frame, base);
        break;
    }
  }

  private emitBookDelta(frame: Json, base: { symbol: string; source: string; receivedAt: number }) {
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    for (const change of list(frame, 'changes')) {
      if (!Array.isArray(change)) throw new Error('change is not a list');
      const [side, price, size] = change as unknown[];
      const [level] = levels([[price, size]]);
      if (!level) continue;
      if (side === 'buy') bids.push(level);
      else if (side === 'sell') asks.push(level);
    }
    this.ctx.emit({ ...base, channel: 'book', ts: time(frame, 'time'), kind: 'delta', bids, asks });
  }

  /** Fold a match into the current 1-minute bar and emit the bar. */
  private updateBar(
    product: string,
    base: { symbol: string; source: string; receivedAt: number },
    ts: number,
    price: number,
    size: number,
  ): void {
    const bar = this.bars.fold(product, ts, price, size);
    if (bar) this.ctx.emit({ ...base, channel: 'bar', interval: '1m', ...bar });
  }
}
