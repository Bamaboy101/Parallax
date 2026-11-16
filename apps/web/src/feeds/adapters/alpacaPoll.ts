import {
  FeedAuthError,
  type AdapterContext,
  type Channel,
  type FeedAdapter,
  type SymbolRef,
} from '../types';
import { credentials, REST, restQueue } from './alpaca';
import { field, isObject, obj, time, type Json } from './parse';
import { getJson, HttpError } from './rest';

/** One snapshot request every 15 s: 4 of Basic's 200 calls a minute, however many symbols. */
export const ALPACA_POLL_MS = 15_000;
/** A symbol subscribed between polls is fetched this soon, so a row fills almost at once. */
const POLL_SOON_MS = 250;
/** Tickers per request, keeping the URL short. */
const TICKERS_PER_REQUEST = 100;

/**
 * Alpaca snapshots on a timer: the fallback for US stocks and ETFs past the 30-symbol stream.
 * Each poll emits the latest IEX trade (only when it is newer than the last one, so a tape never
 * repeats a print), the latest quote, and the last completed minute bar. Quotes go out for every
 * polled ticker, which also keeps this source's truth badge honest while a quiet ETF has no new
 * trade.
 */
export class AlpacaPollAdapter implements FeedAdapter {
  readonly id = 'alpaca-poll';
  readonly needsKey = true;

  /** Ticker → app symbol. */
  private readonly symbols = new Map<string, SymbolRef>();
  /** `${ticker}|${channel}` for every app subscription. */
  private readonly wanted = new Set<string>();
  /** Ticker → time of the last trade emitted. */
  private readonly lastTrade = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Ends the running connect(); unset when not running. */
  private finish: ((error?: unknown) => void) | undefined;

  constructor(private readonly ctx: AdapterContext) {}

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'equity' && symbol.quote === 'USD';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    if (channel === 'book') return;
    this.symbols.set(symbol.base, symbol);
    this.wanted.add(`${symbol.base}|${channel}`);
    if (this.finish) this.schedule(POLL_SOON_MS);
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
    this.wanted.delete(`${symbol.base}|${channel}`);
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.finish = (error) => {
        this.finish = undefined;
        globalThis.clearTimeout(this.timer);
        if (error === undefined) resolve();
        else reject(error instanceof Error ? error : new Error('snapshot poll failed'));
      };
      this.schedule(0);
    });
  }

  dispose(): void {
    this.finish?.();
  }

  private schedule(delayMs: number): void {
    globalThis.clearTimeout(this.timer);
    this.timer = globalThis.setTimeout(() => {
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    const tickers = [...new Set([...this.wanted].map((key) => key.split('|')[0] ?? ''))];
    try {
      for (let start = 0; start < tickers.length; start += TICKERS_PER_REQUEST) {
        await this.fetchSnapshots(tickers.slice(start, start + TICKERS_PER_REQUEST));
      }
    } catch (error) {
      const refused = error instanceof HttpError && (error.status === 401 || error.status === 403);
      // The hub retries a failed connection with backoff, and stops on FeedAuthError.
      this.finish?.(refused ? new FeedAuthError('Alpaca rejected the key') : error);
      return;
    }
    if (this.finish) this.schedule(ALPACA_POLL_MS);
  }

  private async fetchSnapshots(tickers: string[]): Promise<void> {
    const auth = credentials(this.ctx.getKey('alpaca'));
    if (!auth) throw new FeedAuthError('no Alpaca key');
    const headers = { 'APCA-API-KEY-ID': auth.key, 'APCA-API-SECRET-KEY': auth.secret };
    // feed=iex: the same exchange as the stream, so a symbol reads the same either way.
    const url = `${REST}/snapshots?symbols=${encodeURIComponent(tickers.join(','))}&feed=iex`;
    const body = await restQueue(() => getJson(url, headers));
    // Disposed while the request was out: its answer belongs to nobody.
    if (!this.finish) return;
    if (!isObject(body)) throw new Error('snapshots response is not an object');
    const receivedAt = Date.now();
    // Unknown tickers are simply missing from the answer.
    for (const ticker of tickers) {
      const snapshot = body[ticker];
      if (!isObject(snapshot)) continue;
      try {
        this.emitSnapshot(ticker, snapshot, receivedAt);
      } catch (error) {
        this.ctx.log('warn', `unreadable ${ticker} snapshot: ${String(error)}`);
      }
    }
  }

  private emitSnapshot(ticker: string, snapshot: Json, receivedAt: number): void {
    const symbol = this.symbols.get(ticker);
    if (!symbol) return;
    const base = { symbol: symbol.id, source: this.id, receivedAt };
    if (isObject(snapshot.latestQuote)) {
      const quote = snapshot.latestQuote;
      this.ctx.emit({
        ...base,
        channel: 'quote',
        ts: time(quote, 't'),
        bid: field(quote, 'bp'),
        bidSize: field(quote, 'bs'),
        ask: field(quote, 'ap'),
        askSize: field(quote, 'as'),
      });
    }
    if (this.wanted.has(`${ticker}|trade`) && isObject(snapshot.latestTrade)) {
      const trade = snapshot.latestTrade;
      const ts = time(trade, 't');
      if (ts > (this.lastTrade.get(ticker) ?? 0)) {
        this.lastTrade.set(ticker, ts);
        this.ctx.emit({
          ...base,
          channel: 'trade',
          ts,
          price: field(trade, 'p'),
          size: field(trade, 's'),
        });
      }
    }
    if (this.wanted.has(`${ticker}|bar`) && isObject(snapshot.minuteBar)) {
      const bar = obj(snapshot, 'minuteBar');
      this.ctx.emit({
        ...base,
        channel: 'bar',
        interval: '1m',
        ts: time(bar, 't'),
        open: field(bar, 'o'),
        high: field(bar, 'h'),
        low: field(bar, 'l'),
        close: field(bar, 'c'),
        volume: field(bar, 'v'),
      });
    }
  }
}
