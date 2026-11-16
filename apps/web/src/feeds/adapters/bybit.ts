import type { AdapterContext, Channel, FeedAdapter, SymbolRef } from '../types';
import { field, isObject, list, num, obj, parseFrame, str, type Json } from './parse';
import { SocketAdapter, browserSocket, type SocketFactory } from './socket';

/** Public USDT perpetuals; no key. */
const URL = 'wss://stream.bybit.com/v5/public/linear';
/** Bybit closes a public socket that has not pinged for a while; it asks for every 20 s. */
const PING_MS = 20_000;
const CONTROL_GAP_MS = 100;

/** Ticker fields that change what a DerivEvent says; deltas touching none are skipped. */
const DERIV_FIELDS = ['markPrice', 'fundingRate', 'nextFundingTime', 'openInterest'];

function topicOf(symbol: SymbolRef, channel: Channel): string | null {
  const pair = `${symbol.base}${symbol.quote}`;
  if (channel === 'deriv') return `tickers.${pair}`;
  if (channel === 'liquidation') return `allLiquidation.${pair}`;
  return null;
}

const optional = (value: unknown) =>
  value === undefined || value === '' ? null : num(value, 'open interest');

/**
 * Bybit USDT perpetuals: funding, mark price and open interest from `tickers` (a snapshot, then
 * deltas every 100 ms), and every liquidation from `allLiquidation` (batched every 500 ms).
 */
export class BybitAdapter extends SocketAdapter implements FeedAdapter {
  readonly id = 'bybit';
  readonly needsKey = false;
  protected readonly url = URL;

  /** Topic → subscribed symbol and channel. */
  private readonly topics = new Map<string, { symbol: SymbolRef; channel: Channel }>();
  /** Topics the server has been told about. */
  private sent = new Set<string>();
  /** Topic → the ticker so far: the snapshot with every delta applied. */
  private readonly tickers = new Map<string, Json>();
  private flushTimer: number | undefined;

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'perp' && symbol.quote === 'USDT';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    const topic = topicOf(symbol, channel);
    if (!topic) return;
    this.topics.set(topic, { symbol, channel });
    this.scheduleFlush();
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
    const topic = topicOf(symbol, channel);
    if (!topic || !this.topics.delete(topic)) return;
    this.tickers.delete(topic);
    this.scheduleFlush();
  }

  override dispose(): void {
    globalThis.clearTimeout(this.flushTimer);
    super.dispose();
  }

  protected onOpen(): void {
    this.keepAlive(PING_MS, { op: 'ping' });
    this.sent = new Set();
    this.tickers.clear();
    this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || !this.isOpen) return;
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, CONTROL_GAP_MS);
  }

  private flush(): void {
    if (!this.isOpen) return;
    const wanted = new Set(this.topics.keys());
    const removing = [...this.sent].filter((topic) => !wanted.has(topic));
    const adding = [...wanted].filter((topic) => !this.sent.has(topic));
    if (removing.length > 0) this.send({ op: 'unsubscribe', args: removing });
    if (adding.length > 0) this.send({ op: 'subscribe', args: adding });
    this.sent = wanted;
  }

  protected onMessage(text: string, receivedAt: number): void {
    const frame = parseFrame(text);
    // Acknowledgements and pongs carry `op`.
    if ('op' in frame) {
      if (frame.success === false)
        this.ctx.log('warn', `request rejected: ${String(frame.ret_msg)}`);
      return;
    }
    const topic = str(frame, 'topic');
    const target = this.topics.get(topic);
    if (!target) return; // a late frame after unsubscribe
    const base = { symbol: target.symbol.id, source: this.id, receivedAt };

    if (target.channel === 'deriv') {
      const data = obj(frame, 'data');
      const previous = frame.type === 'snapshot' ? {} : (this.tickers.get(topic) ?? {});
      const ticker = { ...previous, ...data };
      this.tickers.set(topic, ticker);
      if (frame.type !== 'snapshot' && !DERIV_FIELDS.some((key) => key in data)) return;
      if (ticker.markPrice === undefined || ticker.fundingRate === undefined) return;
      this.ctx.emit({
        ...base,
        channel: 'deriv',
        ts: field(frame, 'ts'),
        markPrice: field(ticker, 'markPrice'),
        fundingRate: field(ticker, 'fundingRate'),
        nextFundingTime: field(ticker, 'nextFundingTime'),
        // Linear contracts: `openInterest` in the coin, `openInterestValue` in USD.
        openInterest: optional(ticker.openInterest),
        openInterestUsd: optional(ticker.openInterestValue),
      });
      return;
    }

    for (const entry of list(frame, 'data')) {
      if (!isObject(entry)) continue;
      this.ctx.emit({
        ...base,
        channel: 'liquidation',
        ts: field(entry, 'T'),
        // Bybit names the liquidated position: `Buy` means a long was liquidated.
        side: str(entry, 'S') === 'Buy' ? 'long' : 'short',
        price: field(entry, 'p'),
        size: field(entry, 'v'),
      });
    }
  }
}
