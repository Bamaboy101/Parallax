/**
 * Feed contract of record. docs/architecture.md describes the same types; change both together.
 * All times are Unix epoch milliseconds.
 */

/**
 * `deriv`: funding rate, mark price and open interest of a perpetual future.
 * `liquidation`: forced closes of perpetual positions.
 */
export type Channel = 'trade' | 'quote' | 'book' | 'bar' | 'deriv' | 'liquidation';

/** The price channels of spot crypto, FX and stocks: everything except the perp channels. */
export type MarketChannel = Exclude<Channel, 'deriv' | 'liquidation'>;

export const isMarketChannel = (channel: Channel): channel is MarketChannel =>
  channel !== 'deriv' && channel !== 'liquidation';

export type BarInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export const INTERVAL_MS: Readonly<Record<BarInterval, number>> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

/** `perp`: a perpetual future, quoted in `quote` (USDT), on its own symbol id ('BTC-USDT-PERP'). */
export type AssetKind = 'crypto' | 'equity' | 'fx' | 'perp';

/** One instrument as the app names it. `id` is the key used in events and the store. */
export interface SymbolRef {
  /** Canonical id: 'BTC-USD', 'ETH-USDT', 'AAPL', 'EUR-USD'. */
  id: string;
  kind: AssetKind;
  /** 'BTC', 'AAPL', 'EUR'. */
  base: string;
  /** Quote currency: 'USD', 'USDT'. Prices are always in this currency. */
  quote: string;
}

export interface BaseEvent {
  /** SymbolRef.id */
  symbol: string;
  /** Provider (exchange) timestamp. */
  ts: number;
  /** Local time the message arrived; truth badges derive data age from it. */
  receivedAt: number;
  /** Adapter id. */
  source: string;
}

export interface TradeEvent extends BaseEvent {
  channel: 'trade';
  price: number;
  size: number;
}

export interface QuoteEvent extends BaseEvent {
  channel: 'quote';
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
}

export type Level = [price: number, size: number];

export interface BookEvent extends BaseEvent {
  channel: 'book';
  /** In a delta, size 0 removes the level. */
  kind: 'snapshot' | 'delta';
  bids: Level[];
  asks: Level[];
}

export interface Bar {
  /** Bar open time. */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarEvent extends BaseEvent, Bar {
  channel: 'bar';
  interval: BarInterval;
}

/** A perpetual future's funding and positioning, as one snapshot per update. */
export interface DerivEvent extends BaseEvent {
  channel: 'deriv';
  markPrice: number;
  /** Rate for the current funding interval as a fraction: 0.0001 is 0.01%. Positive: longs pay. */
  fundingRate: number;
  /** When the current interval settles. */
  nextFundingTime: number;
  /** Open interest in the base coin, and in USD; null until the feed has reported it. */
  openInterest: number | null;
  openInterestUsd: number | null;
}

/** One forced close. A `long` liquidation is a forced sell of a long position. */
export interface LiquidationEvent extends BaseEvent {
  channel: 'liquidation';
  side: 'long' | 'short';
  price: number;
  /** In the base coin. */
  size: number;
}

export type FeedEvent =
  TradeEvent | QuoteEvent | BookEvent | BarEvent | DerivEvent | LiquidationEvent;

/** One headline, from a feed's company news or the edge's publisher RSS. */
export interface NewsItem {
  title: string;
  url: string;
  /** Publisher name, e.g. 'Reuters'. */
  source: string;
  /** Epoch ms; 0 when unknown. */
  published: number;
  summary: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Never pass a key, or a URL that contains one, to a logger. */
export type Logger = (level: LogLevel, message: string) => void;

export interface AdapterContext {
  /** Send one normalised event to the hub. */
  emit(event: FeedEvent): void;
  /**
   * The user's key for a provider, or undefined if none is stored. Providers with two-part
   * credentials get them joined by ':' (Alpaca: 'KEY_ID:SECRET').
   */
  getKey(provider: string): string | undefined;
  log: Logger;
}

export interface FeedAdapter {
  /** 'binance', 'alpaca', ... */
  id: string;
  needsKey: boolean;
  supports(symbol: SymbolRef): boolean;
  /** May be called before connect(); the adapter applies it once its connection is open. */
  subscribe(symbol: SymbolRef, channel: Channel): void;
  unsubscribe(symbol: SymbolRef, channel: Channel): void;
  /**
   * Run one connection. Resolves when the connection closes, rejects when it fails. Reject with
   * FeedAuthError when the provider refuses the key, so the hub stops retrying. The hub owns
   * reconnect and backoff: it builds a fresh adapter for every attempt.
   */
  connect(): Promise<void>;
  /** Close sockets and clear timers. connect() must settle soon after. */
  dispose(): void;
  /** Optional REST history. Only the hub calls this. */
  fetchHistory?(symbol: SymbolRef, interval: BarInterval, from: number, to: number): Promise<Bar[]>;
  /** Optional company news for a symbol, newest first. Only the hub calls this. */
  fetchNews?(symbol: SymbolRef, from: number, to: number): Promise<NewsItem[]>;
  /**
   * Optional key check for the Settings "test my key" button. Resolves when the provider accepts
   * the key from `ctx.getKey`, rejects with FeedAuthError when it refuses it, and with any other
   * error when the check could not run. Only the hub calls this, on a throwaway instance.
   */
  verifyKey?(): Promise<void>;
}

export type AdapterFactory = (ctx: AdapterContext) => FeedAdapter;

/** The provider rejected the user's key. The hub waits for a new key instead of retrying. */
export class FeedAuthError extends Error {
  override name = 'FeedAuthError';
}

/** How long a source may stay silent before its badge turns stale. */
export interface StalePolicy {
  staleAfterMs: number;
  /** When set, staleness only counts while this returns true (market hours for equities). */
  isActive?: (now: number) => boolean;
}

export interface AdapterRegistration {
  factory: AdapterFactory;
  stale: StalePolicy;
  /**
   * Most distinct symbols one connection may stream (Alpaca Basic: 30). The hub never routes
   * more; extra symbols go to the next feed, or wait and are reported in the source status.
   */
  symbolLimit?: number;
  /** The provider whose key the source uses, when it is not the adapter id ('alpaca-poll'). */
  key?: string;
  /** For a source that polls REST instead of streaming: how often, shown on its truth badge. */
  pollMs?: number;
}
