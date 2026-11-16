import type { Bar, BarInterval, Channel, FeedEvent, NewsItem, SymbolRef } from './types';

/** Messages from the app to the hub worker. */
export type HubRequest =
  | { type: 'subscribe'; symbol: SymbolRef; channel: Channel }
  | { type: 'unsubscribe'; symbol: SymbolRef; channel: Channel }
  /** Full replacement of the user's keys, by provider id. */
  | { type: 'keys'; keys: Record<string, string> }
  | {
      type: 'history';
      requestId: number;
      symbol: SymbolRef;
      interval: BarInterval;
      from: number;
      to: number;
    }
  /** Company news for a symbol from the first feed that has it. */
  | { type: 'news'; requestId: number; symbol: SymbolRef; from: number; to: number }
  /** Check a key the user has typed, before it is saved. */
  | { type: 'verify-key'; requestId: number; provider: string; key: string };

export type SourceState =
  /** Registered, no subscriptions yet. */
  | 'idle'
  /** First attempt in progress, no message yet. */
  | 'connecting'
  /** Messages are arriving. */
  | 'live'
  /** Connection lost; waiting for the next attempt or for its first message. */
  | 'reconnecting'
  /** The source needs a key and none is stored. */
  | 'no-key'
  /** The provider rejected the stored key. */
  | 'auth-failed'
  /** Failed repeatedly; its subscriptions moved to a fallback feed until `retryAt`. */
  | 'down';
export interface SourceStatus {
  source: string;
  state: SourceState;
  /** receivedAt of the last event. */
  lastEventAt: number | null;
  /** receivedAt − ts of the last trade, quote or book event: exchange-to-browser delay. */
  latencyMs: number | null;
  /** Live, but silent for longer than the source's stale policy allows. */
  stale: boolean;
  /** Failed attempts since the last message. */
  attempt: number;
  /** When the next reconnect attempt is due. */
  retryAt: number | null;
  /** Distinct symbols this source is serving. */
  symbols: number;
  /** The provider's stream symbol cap, or null when it has none. */
  symbolLimit: number | null;
  /** Symbols that wanted this source but found it full and had no other usable feed. */
  waiting: string[];
}

/** Outcome of a 'verify-key' request. */
export type VerifyOutcome =
  | { result: 'accepted' }
  | { result: 'rejected'; message: string }
  /** The check could not run: no network, provider error, no test for this provider. */
  | { result: 'failed'; message: string };

/** Messages from the hub worker to the app. */
export type HubMessage =
  | { type: 'events'; events: FeedEvent[] }
  | { type: 'status'; sources: SourceStatus[] }
  | { type: 'history'; requestId: number; bars: Bar[] }
  | { type: 'history-error'; requestId: number; message: string }
  | { type: 'news'; requestId: number; items: NewsItem[]; source: string }
  | { type: 'news-error'; requestId: number; message: string }
  | { type: 'verify-result'; requestId: number; outcome: VerifyOutcome };
