import type { Bar, BarInterval, Channel, FeedEvent, SymbolRef } from './types';

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
    };

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
  | 'auth-failed';

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
}

/** Messages from the hub worker to the app. */
export type HubMessage =
  | { type: 'events'; events: FeedEvent[] }
  | { type: 'status'; sources: SourceStatus[] }
  | { type: 'history'; requestId: number; bars: Bar[] }
  | { type: 'history-error'; requestId: number; message: string };
