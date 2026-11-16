import {
  FeedAuthError,
  type AdapterContext,
  type Channel,
  type FeedAdapter,
  type SymbolRef,
} from '../types';
import { MinuteBars } from './bars';
import { field, isObject, list, parseFrame, str } from './parse';
import { getJson, HttpError, throttle } from './rest';
import { SocketAdapter, browserSocket, type SocketFactory } from './socket';

const STREAM = 'wss://ws.finnhub.io';
const REST = 'https://finnhub.io/api/v1';
/** Free plan: 50 symbols on the stream. The hub enforces it through the registration. */
export const FINNHUB_SYMBOL_LIMIT = 50;
/** Free plan: 60 REST calls a minute. Only key checks use REST here. */
const restQueue = throttle(1000);

/** Channels the free trade stream can serve; quotes and books are not offered. */
const SERVED = new Set<Channel>(['trade', 'bar']);

/**
 * Finnhub free plan: live US stock trades over WebSocket. Stock candles are a paid feature, so
 * this feed has no history; Alpaca provides it when both keys are stored.
 */
export class FinnhubAdapter extends SocketAdapter implements FeedAdapter {
  readonly id = 'finnhub';
  readonly needsKey = true;

  /** Ticker → app symbol. */
  private readonly symbols = new Map<string, SymbolRef>();
  /** `${ticker}|${channel}` for every app subscription. */
  private readonly wanted = new Set<string>();
  private readonly bars = new MinuteBars();

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  /** The token must ride in the URL; the URL is never logged. */
  protected get url(): string {
    return `${STREAM}?token=${encodeURIComponent(this.ctx.getKey(this.id) ?? '')}`;
  }

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'equity' && symbol.quote === 'USD';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    if (!SERVED.has(channel)) return;
    const ticker = symbol.base;
    const already = this.streaming(ticker);
    this.symbols.set(ticker, symbol);
    this.wanted.add(`${ticker}|${channel}`);
    if (!already) this.send({ type: 'subscribe', symbol: ticker });
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
    const ticker = symbol.base;
    if (!this.wanted.delete(`${ticker}|${channel}`)) return;
    if (channel === 'bar') this.bars.delete(ticker);
    if (!this.streaming(ticker)) this.send({ type: 'unsubscribe', symbol: ticker });
  }

  /**
   * A refused token fails the WebSocket handshake with no reason the browser can read, so a
   * connection that never opened asks REST whether the key is the problem.
   */
  override async connect(): Promise<void> {
    try {
      await super.connect();
    } catch (error) {
      if (!this.opened && !this.disposed) await this.verifyKey();
      throw error;
    }
  }

  /**
   * One quote request: 401 means Finnhub refuses the key. The token rides in the query because
   * Finnhub's CORS preflight does not allow its X-Finnhub-Token header from a browser; HttpError
   * carries only the host, so the URL is never logged.
   */
  async verifyKey(): Promise<void> {
    const token = this.ctx.getKey(this.id);
    if (!token) throw new FeedAuthError('no Finnhub key');
    try {
      await restQueue(() =>
        getJson(`${REST}/quote?symbol=AAPL&token=${encodeURIComponent(token)}`),
      );
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        throw new FeedAuthError('Finnhub rejected the key');
      }
      throw error;
    }
  }

  protected onOpen(): void {
    const tickers = new Set([...this.wanted].map((key) => key.split('|')[0] ?? ''));
    for (const ticker of tickers) this.send({ type: 'subscribe', symbol: ticker });
  }

  protected onMessage(text: string, receivedAt: number): void {
    const frame = parseFrame(text);
    const type = str(frame, 'type');
    if (type === 'error') {
      this.ctx.log('warn', `Finnhub: ${typeof frame.msg === 'string' ? frame.msg : 'error'}`);
      return;
    }
    if (type !== 'trade') return;
    for (const trade of list(frame, 'data')) {
      if (!isObject(trade)) continue;
      const ticker = str(trade, 's');
      const symbol = this.symbols.get(ticker);
      if (!symbol) continue;
      const base = { symbol: symbol.id, source: this.id, receivedAt };
      const ts = field(trade, 't');
      const price = field(trade, 'p');
      const size = field(trade, 'v');
      if (this.wanted.has(`${ticker}|trade`)) {
        this.ctx.emit({ ...base, channel: 'trade', ts, price, size });
      }
      if (this.wanted.has(`${ticker}|bar`)) {
        const bar = this.bars.fold(ticker, ts, price, size);
        if (bar) this.ctx.emit({ ...base, channel: 'bar', interval: '1m', ...bar });
      }
    }
  }

  private streaming(ticker: string): boolean {
    return [...SERVED].some((channel) => this.wanted.has(`${ticker}|${channel}`));
  }
}
