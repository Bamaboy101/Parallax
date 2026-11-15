/**
 * Feed contract of record. docs/architecture.md describes the same types; change both together.
 * All times are Unix epoch milliseconds.
 */

export type Channel = 'trade' | 'quote' | 'book' | 'bar';

export type BarInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type AssetKind = 'crypto' | 'equity' | 'fx';

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

export type FeedEvent = TradeEvent | QuoteEvent | BookEvent | BarEvent;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Never pass a key, or a URL that contains one, to a logger. */
export type Logger = (level: LogLevel, message: string) => void;

export interface AdapterContext {
  /** Send one normalised event to the hub. */
  emit(event: FeedEvent): void;
  /** The user's key for a provider, or undefined if none is stored. */
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
}
