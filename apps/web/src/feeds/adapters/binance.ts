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
import { field, levels, list, num, obj, parseFrame, str } from './parse';
import { getJson, throttle, tidy } from './rest';
import { SocketAdapter, browserSocket, type SocketFactory } from './socket';

/** Market-data-only endpoint; serves the same public streams as stream.binance.com. */
const URL = 'wss://data-stream.binance.vision/stream';
const KLINES = 'https://data-api.binance.vision/api/v3/klines';
const KLINE_LIMIT = 1000;
const MAX_PAGES = 3;
/** Binance's REST weight limit is generous; a small gap keeps bursts polite. */
const restQueue = throttle(100);
/** Binance allows 5 control messages per second per connection; stay well under it. */
const CONTROL_GAP_MS = 250;
/** Keep each SUBSCRIBE frame small. */
const MAX_PARAMS = 100;

function streamName(symbol: SymbolRef, channel: MarketChannel): string {
  const pair = `${symbol.base}${symbol.quote}`.toLowerCase();
  switch (channel) {
    case 'trade':
      return `${pair}@trade`;
    case 'quote':
      return `${pair}@bookTicker`;
    case 'book':
      return `${pair}@depth20@100ms`;
    case 'bar':
      return `${pair}@kline_1m`;
  }
}

/**
 * Binance spot. USDT pairs only, labelled USDT: a USDT price is never shown as USD.
 * Trades, best bid/ask, top-20 book snapshots every 100 ms, and 1-minute bars.
 */
export class BinanceAdapter extends SocketAdapter implements FeedAdapter {
  readonly id = 'binance';
  readonly needsKey = false;
  protected readonly url = URL;

  /** Stream name → subscribed symbol and channel. */
  private readonly streams = new Map<string, { symbol: SymbolRef; channel: MarketChannel }>();
  private readonly toSubscribe = new Set<string>();
  private readonly toUnsubscribe = new Set<string>();
  private flushTimer: number | undefined;
  private requestId = 0;

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  /** Klines from the public market-data REST host, up to 3,000 bars per request. */
  async fetchHistory(
    symbol: SymbolRef,
    interval: BarInterval,
    from: number,
    to: number,
  ): Promise<Bar[]> {
    const pair = `${symbol.base}${symbol.quote}`.toUpperCase();
    const bars: Bar[] = [];
    let start = Math.max(from, to - MAX_PAGES * KLINE_LIMIT * INTERVAL_MS[interval]);
    for (let page = 0; page < MAX_PAGES && start <= to; page += 1) {
      const url = `${KLINES}?symbol=${pair}&interval=${interval}&startTime=${String(start)}&endTime=${String(to)}&limit=${String(KLINE_LIMIT)}`;
      const rows = await restQueue(() => getJson(url));
      if (!Array.isArray(rows)) throw new Error('klines response is not a list');
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        bars.push({
          ts: num(row[0]),
          open: num(row[1]),
          high: num(row[2]),
          low: num(row[3]),
          close: num(row[4]),
          volume: num(row[5]),
        });
      }
      const last = bars.at(-1);
      if (rows.length < KLINE_LIMIT || !last) break;
      start = last.ts + INTERVAL_MS[interval];
    }
    return tidy(bars, from, to);
  }

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'crypto' && symbol.quote === 'USDT';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    if (!isMarketChannel(channel)) return;
    const name = streamName(symbol, channel);
    this.streams.set(name, { symbol, channel });
    this.toUnsubscribe.delete(name);
    this.toSubscribe.add(name);
    this.scheduleFlush();
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
    if (!isMarketChannel(channel)) return;
    const name = streamName(symbol, channel);
    if (!this.streams.delete(name)) return;
    this.toSubscribe.delete(name);
    this.toUnsubscribe.add(name);
    this.scheduleFlush();
  }

  override dispose(): void {
    globalThis.clearTimeout(this.flushTimer);
    super.dispose();
  }

  protected onOpen(): void {
    this.toUnsubscribe.clear();
    for (const name of this.streams.keys()) this.toSubscribe.add(name);
    this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || !this.isOpen) return;
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, CONTROL_GAP_MS);
  }

  /** One control message per call; anything left waits for the next gap. */
  private flush(): void {
    if (!this.isOpen) return;
    const [method, pending] =
      this.toUnsubscribe.size > 0
        ? (['UNSUBSCRIBE', this.toUnsubscribe] as const)
        : (['SUBSCRIBE', this.toSubscribe] as const);
    if (pending.size === 0) return;
    const params = [...pending].slice(0, MAX_PARAMS);
    for (const name of params) pending.delete(name);
    this.requestId += 1;
    this.send({ method, params, id: this.requestId });
    if (this.toSubscribe.size > 0 || this.toUnsubscribe.size > 0) this.scheduleFlush();
  }

  protected onMessage(text: string, receivedAt: number): void {
    const frame = parseFrame(text);
    if ('code' in frame) {
      this.ctx.log('warn', `request rejected: ${String(frame.msg)}`);
      return;
    }
    if (!('stream' in frame)) return; // subscription acknowledgement
    const name = str(frame, 'stream');
    const data = obj(frame, 'data');
    if (data.e === 'serverShutdown') {
      this.close();
      return;
    }
    const target = this.streams.get(name);
    if (!target) return; // a late frame after unsubscribe
    const base = { symbol: target.symbol.id, source: this.id, receivedAt };

    switch (target.channel) {
      case 'trade':
        this.ctx.emit({
          ...base,
          channel: 'trade',
          ts: field(data, 'T'),
          price: field(data, 'p'),
          size: field(data, 'q'),
        });
        break;
      case 'quote':
        // bookTicker carries no timestamp.
        this.ctx.emit({
          ...base,
          channel: 'quote',
          ts: receivedAt,
          bid: field(data, 'b'),
          bidSize: field(data, 'B'),
          ask: field(data, 'a'),
          askSize: field(data, 'A'),
        });
        break;
      case 'book':
        // Partial depth streams carry no timestamp; each frame is a full top-20 snapshot.
        this.ctx.emit({
          ...base,
          channel: 'book',
          ts: receivedAt,
          kind: 'snapshot',
          bids: levels(list(data, 'bids')),
          asks: levels(list(data, 'asks')),
        });
        break;
      case 'bar': {
        const k = obj(data, 'k');
        this.ctx.emit({
          ...base,
          channel: 'bar',
          interval: '1m',
          ts: field(k, 't'),
          open: field(k, 'o'),
          high: field(k, 'h'),
          low: field(k, 'l'),
          close: field(k, 'c'),
          volume: field(k, 'v'),
        });
        break;
      }
    }
  }
}
