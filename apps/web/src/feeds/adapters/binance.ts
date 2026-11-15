import type { AdapterContext, Channel, FeedAdapter, SymbolRef } from '../types';
import { field, levels, list, obj, parseFrame, str } from './parse';
import { SocketAdapter, browserSocket, type SocketFactory } from './socket';

/** Market-data-only endpoint; serves the same public streams as stream.binance.com. */
const URL = 'wss://data-stream.binance.vision/stream';
/** Binance allows 5 control messages per second per connection; stay well under it. */
const CONTROL_GAP_MS = 250;
/** Keep each SUBSCRIBE frame small. */
const MAX_PARAMS = 100;

function streamName(symbol: SymbolRef, channel: Channel): string {
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
  private readonly streams = new Map<string, { symbol: SymbolRef; channel: Channel }>();
  private readonly toSubscribe = new Set<string>();
  private readonly toUnsubscribe = new Set<string>();
  private flushTimer: number | undefined;
  private requestId = 0;

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'crypto' && symbol.quote === 'USDT';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    const name = streamName(symbol, channel);
    this.streams.set(name, { symbol, channel });
    this.toUnsubscribe.delete(name);
    this.toSubscribe.add(name);
    this.scheduleFlush();
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
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
