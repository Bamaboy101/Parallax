import type { HubMessage, HubRequest } from '../feeds/protocol';
import type { Bar, BarInterval, Channel, SymbolRef } from '../feeds/types';
import { ingest, setStatuses } from './ticks';

/** The worker as the app sees it; tests pass an in-memory port. */
export interface FeedPort {
  postMessage(message: HubRequest): void;
  onmessage: ((event: MessageEvent<HubMessage>) => void) | null;
}

let port: FeedPort | null = null;
let nextRequestId = 1;
const pendingHistory = new Map<
  number,
  { resolve: (bars: Bar[]) => void; reject: (error: Error) => void }
>();

function handle(message: HubMessage): void {
  switch (message.type) {
    case 'events':
      ingest(message.events);
      break;
    case 'status':
      setStatuses(message.sources);
      break;
    case 'history':
      pendingHistory.get(message.requestId)?.resolve(message.bars);
      pendingHistory.delete(message.requestId);
      break;
    case 'history-error':
      pendingHistory.get(message.requestId)?.reject(new Error(message.message));
      pendingHistory.delete(message.requestId);
      break;
  }
}

/** Attach the feed hub. Without an argument, starts the hub worker on first use. */
export function connectFeed(custom?: FeedPort): FeedPort {
  if (custom) {
    port = custom;
  } else if (!port) {
    port = new Worker(new URL('../feeds/hub.worker.ts', import.meta.url), {
      type: 'module',
      name: 'feed-hub',
    });
  }
  port.onmessage = (event) => {
    handle(event.data);
  };
  return port;
}

/** Detach the current port, e.g. between tests. */
export function disconnectFeed(): void {
  if (port) port.onmessage = null;
  port = null;
  for (const { reject } of pendingHistory.values()) reject(new Error('feed disconnected'));
  pendingHistory.clear();
}

/** Ask the hub for a symbol's channel. Returns the matching release; the hub ref-counts. */
export function subscribeFeed(symbol: SymbolRef, channel: Channel): () => void {
  const target = connectFeed();
  target.postMessage({ type: 'subscribe', symbol, channel });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    target.postMessage({ type: 'unsubscribe', symbol, channel });
  };
}

/** Hand the user's keys to the hub (T12). Keys never leave the browser except to their provider. */
export function setFeedKeys(keys: Record<string, string>): void {
  connectFeed().postMessage({ type: 'keys', keys });
}

/** Bars for a symbol from the first feed with history. */
export function requestHistory(
  symbol: SymbolRef,
  interval: BarInterval,
  from: number,
  to: number,
): Promise<Bar[]> {
  const requestId = nextRequestId;
  nextRequestId += 1;
  return new Promise<Bar[]>((resolve, reject) => {
    pendingHistory.set(requestId, { resolve, reject });
    connectFeed().postMessage({ type: 'history', requestId, symbol, interval, from, to });
  });
}
