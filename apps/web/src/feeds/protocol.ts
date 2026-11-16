import type { Bar, BarInterval, Channel, FeedEvent, NewsItem, SymbolRef } from './types';

/** Messages from the app to the hub worker. */
export type HubRequest =
  /**
   * `background`: the subscriber is off screen. Capped streams serve visible subscriptions
   * first; background ones fall back to a poller. Unsubscribe with the same flag.
   */
  | { type: 'subscribe'; symbol: SymbolRef; channel: Channel; background?: boolean }
  | { type: 'unsubscribe'; symbol: SymbolRef; channel: Channel; background?: boolean }
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
  /** Ids of the symbols this source serves now (its count is the stream's used slots). */
  serving: string[];
  /** The provider's stream symbol cap, or null when it has none. */
  symbolLimit: number | null;
  /** Symbols that wanted this source but found it full and had no other usable feed. */
  waiting: string[];
  /** A polling source's interval, or null for a stream. */
  pollMs: number | null;
  /** The key this source needs (the vault's provider id), or null for a keyless source. */
  key: string | null;
  /** The last failure was the provider's rate limit (HTTP 429); cleared by the next message. */
  rateLimited: boolean;
}

/**
 * Why a history or news request failed, when the app can do something with it: `rate-limited`
 * (retry after `retryAt`, when the provider said) or `no-source` (no usable feed: often no key).
 */
export type RequestFailure =
  { reason: 'rate-limited'; retryAt: number | null } | { reason: 'no-source' };

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
  | { type: 'history-error'; requestId: number; message: string; failure?: RequestFailure }
  | { type: 'news'; requestId: number; items: NewsItem[]; source: string }
  | { type: 'news-error'; requestId: number; message: string; failure?: RequestFailure }
  | { type: 'verify-result'; requestId: number; outcome: VerifyOutcome };
