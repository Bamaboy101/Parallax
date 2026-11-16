import {
  FeedAuthError,
  type AdapterContext,
  type Bar,
  type BarInterval,
  type Channel,
  type FeedAdapter,
  type SymbolRef,
} from '../types';
import { MinuteBars } from './bars';
import { field, isObject, list, num, str, time, type Json } from './parse';
import { getJson, HttpError, throttle, tidy } from './rest';
import { SocketAdapter, browserSocket, type SocketFactory, type SocketLike } from './socket';

/** The Basic (free) plan streams the IEX exchange only. */
const STREAM = 'wss://stream.data.alpaca.markets/v2/iex';
/** Always-on test stream for checking a key, even outside market hours. */
const TEST_STREAM = 'wss://stream.data.alpaca.markets/v2/test';
const TEST_SYMBOL = 'FAKEPACA';
export const REST = 'https://data.alpaca.markets/v2/stocks';
/** Basic plan: 30 symbols on the stream. The hub enforces it through the registration. */
export const ALPACA_SYMBOL_LIMIT = 30;
/** Basic plan: 200 REST calls a minute, shared by history and the snapshot poller. */
export const restQueue = throttle(300);
const BAR_LIMIT = 10_000;
const MAX_PAGES = 5;
const CONTROL_GAP_MS = 100;

const TIMEFRAME: Record<BarInterval, string> = {
  '1m': '1Min',
  '5m': '5Min',
  '15m': '15Min',
  '1h': '1Hour',
  '4h': '4Hour',
  '1d': '1Day',
};

type Upstream = 'trades' | 'quotes';

/**
 * Upstream channel per app channel. The minute-bar channel only fires after each minute closes,
 * so live bars are built from trades and update with every print. IEX has no order book.
 */
const UPSTREAM: Partial<Record<Channel, Upstream>> = {
  trade: 'trades',
  bar: 'trades',
  quote: 'quotes',
};

/** 'KEY_ID:SECRET' from the vault → the two parts, or null when either is missing. */
export function credentials(key: string | undefined): { key: string; secret: string } | null {
  const split = key?.indexOf(':') ?? -1;
  if (!key || split <= 0 || split === key.length - 1) return null;
  return { key: key.slice(0, split), secret: key.slice(split + 1) };
}

/** Alpaca frames are JSON arrays of messages. */
function messages(text: string): Json[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error('frame is not a list');
  return value.filter(isObject);
}

/** Map an Alpaca stream error to how the hub should treat it. */
function streamError(message: Json): Error {
  const code = num(message.code, 'code');
  const text = typeof message.msg === 'string' ? message.msg : 'error';
  if (code === 402) return new FeedAuthError('Alpaca rejected the key (auth failed)');
  if (code === 409) return new FeedAuthError('this key has no access to the IEX feed');
  if (code === 406) {
    return new Error('connection limit exceeded: another app or tab is streaming with this key');
  }
  return new Error(`Alpaca error ${String(code)}: ${text}`);
}

/** Alpaca Market Data, Basic plan: live US stocks and ETFs from IEX, history since 2016. */
export class AlpacaAdapter extends SocketAdapter implements FeedAdapter {
  readonly id = 'alpaca';
  readonly needsKey = true;
  protected readonly url = STREAM;

  /** Ticker → app symbol. */
  private readonly symbols = new Map<string, SymbolRef>();
  /** `${ticker}|${channel}` for every app subscription. */
  private readonly wanted = new Set<string>();
  /** What the server has been told, per upstream channel. */
  private readonly sent: Record<Upstream, Set<string>> = { trades: new Set(), quotes: new Set() };
  private authenticated = false;
  private flushTimer: number | undefined;
  private readonly bars = new MinuteBars();
  private testSocket: SocketLike | null = null;

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'equity' && symbol.quote === 'USD';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    if (!UPSTREAM[channel]) return;
    this.symbols.set(symbol.base, symbol);
    this.wanted.add(`${symbol.base}|${channel}`);
    this.scheduleFlush();
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
    if (!this.wanted.delete(`${symbol.base}|${channel}`)) return;
    if (channel === 'bar') this.bars.delete(symbol.base);
    this.scheduleFlush();
  }

  override dispose(): void {
    globalThis.clearTimeout(this.flushTimer);
    this.testSocket?.close();
    this.testSocket = null;
    super.dispose();
  }

  /**
   * The plan's test-stream check: authenticate on the always-on test stream and wait for the
   * first FAKEPACA message. The live IEX connection is a different endpoint, so the one-connection
   * limit is not spent on it.
   */
  verifyKey(): Promise<void> {
    const auth = credentials(this.ctx.getKey(this.id));
    if (!auth) return Promise.reject(new FeedAuthError('enter both the key ID and the secret'));
    return new Promise<void>((resolve, reject) => {
      const socket = this.createSocket(TEST_STREAM);
      this.testSocket = socket;
      const finish = (error?: Error) => {
        socket.onmessage = null;
        socket.onclose = null;
        socket.close();
        this.testSocket = null;
        if (error) reject(error);
        else resolve();
      };
      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        try {
          for (const message of messages(event.data)) {
            const type = str(message, 'T');
            if (type === 'success' && message.msg === 'connected') {
              socket.send(JSON.stringify({ action: 'auth', ...auth }));
            } else if (type === 'success' && message.msg === 'authenticated') {
              socket.send(
                JSON.stringify({
                  action: 'subscribe',
                  trades: [TEST_SYMBOL],
                  quotes: [TEST_SYMBOL],
                }),
              );
            } else if (type === 'error') {
              finish(streamError(message));
              return;
            } else if (['t', 'q', 'b'].includes(type) && message.S === TEST_SYMBOL) {
              finish();
              return;
            }
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error('unreadable test message'));
        }
      };
      socket.onclose = () => {
        finish(new Error('Alpaca closed the test stream'));
      };
    });
  }

  /** IEX bars from the REST API, oldest first, up to 50,000 per request. */
  async fetchHistory(
    symbol: SymbolRef,
    interval: BarInterval,
    from: number,
    to: number,
  ): Promise<Bar[]> {
    const auth = credentials(this.ctx.getKey(this.id));
    if (!auth) throw new FeedAuthError('no Alpaca key');
    const headers = { 'APCA-API-KEY-ID': auth.key, 'APCA-API-SECRET-KEY': auth.secret };
    const bars: Bar[] = [];
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      // feed=iex matches the live stream, so history and the live bar come from one exchange.
      const url =
        `${REST}/${encodeURIComponent(symbol.base)}/bars?timeframe=${TIMEFRAME[interval]}` +
        `&start=${new Date(from).toISOString()}&end=${new Date(to).toISOString()}` +
        `&limit=${String(BAR_LIMIT)}&feed=iex&adjustment=split&sort=asc` +
        (token ? `&page_token=${encodeURIComponent(token)}` : '');
      let body: unknown;
      try {
        body = await restQueue(() => getJson(url, headers));
      } catch (error) {
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
          throw new FeedAuthError('Alpaca rejected the key');
        }
        throw error;
      }
      if (!isObject(body)) throw new Error('bars response is not an object');
      // An empty range comes back as `"bars": null`.
      for (const row of body.bars === null ? [] : list(body, 'bars')) {
        if (!isObject(row)) continue;
        bars.push({
          ts: time(row, 't'),
          open: field(row, 'o'),
          high: field(row, 'h'),
          low: field(row, 'l'),
          close: field(row, 'c'),
          volume: field(row, 'v'),
        });
      }
      token = typeof body.next_page_token === 'string' ? body.next_page_token : null;
      if (!token) break;
    }
    return tidy(bars, from, to);
  }

  protected onOpen(): void {
    this.authenticated = false;
    this.sent.trades.clear();
    this.sent.quotes.clear();
  }

  protected onMessage(text: string, receivedAt: number): void {
    for (const message of messages(text)) {
      switch (str(message, 'T')) {
        case 'success':
          if (message.msg === 'connected') this.authenticate();
          else if (message.msg === 'authenticated') {
            this.authenticated = true;
            this.flush();
          }
          break;
        case 'error': {
          const error = streamError(message);
          if (num(message.code, 'code') === 405) {
            this.ctx.log('warn', 'Alpaca symbol limit exceeded');
          } else {
            this.fail(error);
          }
          break;
        }
        case 't':
          this.onTrade(message, receivedAt);
          break;
        case 'q':
          this.onQuote(message, receivedAt);
          break;
      }
    }
  }

  private authenticate(): void {
    const auth = credentials(this.ctx.getKey(this.id));
    if (!auth) {
      this.fail(new FeedAuthError('no Alpaca key'));
      return;
    }
    this.send({ action: 'auth', ...auth });
  }

  private onTrade(message: Json, receivedAt: number): void {
    const ticker = str(message, 'S');
    const symbol = this.symbols.get(ticker);
    if (!symbol) return;
    const base = { symbol: symbol.id, source: this.id, receivedAt };
    const ts = time(message, 't');
    const price = field(message, 'p');
    const size = field(message, 's');
    if (this.wanted.has(`${ticker}|trade`)) {
      this.ctx.emit({ ...base, channel: 'trade', ts, price, size });
    }
    if (this.wanted.has(`${ticker}|bar`)) {
      const bar = this.bars.fold(ticker, ts, price, size);
      if (bar) this.ctx.emit({ ...base, channel: 'bar', interval: '1m', ...bar });
    }
  }

  private onQuote(message: Json, receivedAt: number): void {
    const ticker = str(message, 'S');
    const symbol = this.symbols.get(ticker);
    if (!symbol || !this.wanted.has(`${ticker}|quote`)) return;
    this.ctx.emit({
      symbol: symbol.id,
      source: this.id,
      receivedAt,
      channel: 'quote',
      ts: time(message, 't'),
      bid: field(message, 'bp'),
      bidSize: field(message, 'bs'),
      ask: field(message, 'ap'),
      askSize: field(message, 'as'),
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || !this.authenticated) return;
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, CONTROL_GAP_MS);
  }

  /** Send the difference between what is wanted and what the server has. */
  private flush(): void {
    if (!this.authenticated) return;
    const desired: Record<Upstream, Set<string>> = { trades: new Set(), quotes: new Set() };
    for (const key of this.wanted) {
      const [ticker = '', channel = ''] = key.split('|');
      const upstream = UPSTREAM[channel as Channel];
      if (upstream) desired[upstream].add(ticker);
    }
    const add: Partial<Record<Upstream, string[]>> = {};
    const remove: Partial<Record<Upstream, string[]>> = {};
    for (const upstream of ['trades', 'quotes'] as const) {
      const adding = [...desired[upstream]].filter((ticker) => !this.sent[upstream].has(ticker));
      const removing = [...this.sent[upstream]].filter((ticker) => !desired[upstream].has(ticker));
      if (adding.length > 0) add[upstream] = adding;
      if (removing.length > 0) remove[upstream] = removing;
      this.sent[upstream] = desired[upstream];
    }
    if (Object.keys(remove).length > 0) this.send({ action: 'unsubscribe', ...remove });
    if (Object.keys(add).length > 0) this.send({ action: 'subscribe', ...add });
  }
}
