import type { HubMessage, HubRequest, VerifyOutcome } from '../feeds/protocol';
import type { Bar, BarInterval, Channel, NewsItem, SymbolRef } from '../feeds/types';
import { hubRequestError } from './failure';
import { useKeyVault } from './keys';
import { captureEvents, isReplaying } from './recorder';
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
const pendingVerify = new Map<number, (outcome: VerifyOutcome) => void>();

/** Company news and the feed it came from. */
export interface CompanyNews {
  items: NewsItem[];
  source: string;
}
const pendingNews = new Map<
  number,
  { resolve: (news: CompanyNews) => void; reject: (error: Error) => void }
>();

function nextId(): number {
  const id = nextRequestId;
  nextRequestId += 1;
  return id;
}

function handle(message: HubMessage): void {
  switch (message.type) {
    case 'events':
      // F10: while a recorded session replays, live market events are set aside (the page
      // reloads when the replay ends); while recording, they are kept for the file too.
      if (isReplaying()) break;
      captureEvents(message.events);
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
      pendingHistory
        .get(message.requestId)
        ?.reject(hubRequestError(message.message, message.failure));
      pendingHistory.delete(message.requestId);
      break;
    case 'news':
      pendingNews.get(message.requestId)?.resolve({ items: message.items, source: message.source });
      pendingNews.delete(message.requestId);
      break;
    case 'news-error':
      pendingNews.get(message.requestId)?.reject(hubRequestError(message.message, message.failure));
      pendingNews.delete(message.requestId);
      break;
    case 'verify-result':
      pendingVerify.get(message.requestId)?.(message.outcome);
      pendingVerify.delete(message.requestId);
      break;
  }
}

/**
 * The hub starts with no keys: a newly attached port gets the vault's keys, and every vault change
 * is forwarded. Keys never leave the browser except to their own provider.
 */
function sendKeys(target: FeedPort): void {
  const { keys } = useKeyVault.getState();
  if (Object.keys(keys).length > 0) target.postMessage({ type: 'keys', keys: { ...keys } });
}

useKeyVault.subscribe((state, previous) => {
  if (port && state.keys !== previous.keys) {
    port.postMessage({ type: 'keys', keys: { ...state.keys } });
  }
});

/** Attach the feed hub. Without an argument, starts the hub worker on first use. */
export function connectFeed(custom?: FeedPort): FeedPort {
  const previous = port;
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
  if (port !== previous) sendKeys(port);
  return port;
}

/** Detach the current port, e.g. between tests. */
export function disconnectFeed(): void {
  if (port) port.onmessage = null;
  port = null;
  for (const { reject } of pendingHistory.values()) reject(new Error('feed disconnected'));
  pendingHistory.clear();
  for (const { reject } of pendingNews.values()) reject(new Error('feed disconnected'));
  pendingNews.clear();
  for (const resolve of pendingVerify.values()) {
    resolve({ result: 'failed', message: 'feed disconnected' });
  }
  pendingVerify.clear();
}

/**
 * Ask the hub for a symbol's channel; `background` marks a subscriber that is off screen.
 * Returns the matching release; the hub ref-counts. The release is posted a microtask later, so
 * an effect that re-subscribes in the same commit (say, a row scrolling into view) adds its new
 * subscription before the old one goes, and the hub never sees the count touch zero.
 */
export function subscribeFeed(symbol: SymbolRef, channel: Channel, background = false): () => void {
  const target = connectFeed();
  target.postMessage({ type: 'subscribe', symbol, channel, background });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    queueMicrotask(() => {
      target.postMessage({ type: 'unsubscribe', symbol, channel, background });
    });
  };
}

/** Ask the provider, through the hub, whether it accepts a key the user has typed. */
export function verifyKey(provider: string, key: string): Promise<VerifyOutcome> {
  const requestId = nextId();
  return new Promise((resolve) => {
    pendingVerify.set(requestId, resolve);
    connectFeed().postMessage({ type: 'verify-key', requestId, provider, key });
  });
}

/** Bars for a symbol from the first feed with history. */
export function requestHistory(
  symbol: SymbolRef,
  interval: BarInterval,
  from: number,
  to: number,
): Promise<Bar[]> {
  const requestId = nextId();
  return new Promise<Bar[]>((resolve, reject) => {
    pendingHistory.set(requestId, { resolve, reject });
    connectFeed().postMessage({ type: 'history', requestId, symbol, interval, from, to });
  });
}

/** Company news for a symbol from the first feed that has it (Finnhub, on the user's key). */
export function requestNews(symbol: SymbolRef, from: number, to: number): Promise<CompanyNews> {
  const requestId = nextId();
  return new Promise<CompanyNews>((resolve, reject) => {
    pendingNews.set(requestId, { resolve, reject });
    connectFeed().postMessage({ type: 'news', requestId, symbol, from, to });
  });
}
