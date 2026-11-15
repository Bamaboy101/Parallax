import type { AdapterContext, Bar, Channel, FeedAdapter, SymbolRef } from '../types';
import { field, levels, list, parseFrame, str, time, type Json } from './parse';
import { SocketAdapter, browserSocket, type SocketFactory } from './socket';

const URL = 'wss://ws-feed.exchange.coinbase.com';
/** Coinbase allows about 8 requests per second per IP; batch changes into one frame per gap. */
const CONTROL_GAP_MS = 150;
const MINUTE_MS = 60_000;

/**
 * Upstream channel per app channel. `level2` needs authentication; `level2_batch` is the keyless
 * equivalent, batched every 50 ms. Coinbase has no candle channel, so 1-minute bars are built
 * from matches.
 */
const UPSTREAM: Record<Channel, string> = {
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
  private readonly bars = new Map<string, Bar>();

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'crypto' && symbol.quote === 'USD';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    const product = productId(symbol);
    this.products.set(product, symbol);
    const upstream = UPSTREAM[channel];
    const already = this.needsUpstream(product, upstream);
    this.wanted.add(`${product}|${channel}`);
    if (!already) this.queue(this.toSubscribe, this.toUnsubscribe, upstream, product);
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
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
      const upstream = UPSTREAM[channel as Channel];
      const products = this.toSubscribe.get(upstream) ?? new Set<string>();
      products.add(product);
      this.toSubscribe.set(upstream, products);
    }
    this.flush();
  }

  private needsUpstream(product: string, upstream: string): boolean {
    return (Object.keys(UPSTREAM) as Channel[]).some(
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
    const open = Math.floor(ts / MINUTE_MS) * MINUTE_MS;
    let bar = this.bars.get(product);
    if (bar && open < bar.ts) return; // out-of-order match from a closed minute
    if (!bar || open > bar.ts) {
      bar = { ts: open, open: price, high: price, low: price, close: price, volume: 0 };
      this.bars.set(product, bar);
    }
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
    bar.close = price;
    bar.volume += size;
    this.ctx.emit({ ...base, channel: 'bar', interval: '1m', ...bar });
  }
}
