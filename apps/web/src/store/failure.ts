import type { RequestFailure } from '../feeds/protocol';

/**
 * Why a REST request (history, news, the edge, Frankfurter) gave nothing, in the terms a panel
 * shows: each kind has its own state, so a rate limit never reads as "broken".
 */
export type Failure =
  /** The provider's rate limit (HTTP 429). `retryAt`: when it said to come back, if it did. */
  | { kind: 'rate-limited'; retryAt: number | null; message: string }
  /** The network is down or the request never reached the server. */
  | { kind: 'offline'; message: string }
  /** No usable feed for the request: usually a missing key. */
  | { kind: 'no-source'; message: string }
  /** The project's edge has no key for this route yet (HTTP 503). */
  | { kind: 'unconfigured'; message: string }
  | { kind: 'error'; message: string };

/** A failed request that carries an HTTP status and, on 429, the server's Retry-After. */
export class RequestError extends Error {
  override name = 'RequestError';
  constructor(
    message: string,
    readonly status: number | null,
    /** Epoch ms the server asked us to wait until, or null. */
    readonly retryAt: number | null = null,
    readonly reason: RequestFailure['reason'] | null = null,
  ) {
    super(message);
  }
}

/** A hub history or news failure as a RequestError the stores can classify. */
export function hubRequestError(message: string, failure: RequestFailure | undefined): Error {
  if (!failure) return new Error(message);
  return failure.reason === 'rate-limited'
    ? new RequestError(message, 429, failure.retryAt, 'rate-limited')
    : new RequestError(message, null, null, 'no-source');
}

/** Retry-After (delta seconds or an HTTP date) as an epoch ms, or null. */
export function retryAtFrom(header: string | null, now = Date.now()): number | null {
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return now + Math.max(0, seconds) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : date;
}

const isOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;

/** Classify anything a request rejected with. */
export function failureOf(error: unknown): Failure {
  const message = error instanceof Error ? error.message : 'request failed';
  if (error instanceof RequestError) {
    if (error.status === 429 || error.reason === 'rate-limited') {
      return { kind: 'rate-limited', retryAt: error.retryAt, message };
    }
    if (error.reason === 'no-source') return { kind: 'no-source', message };
    if (error.status === 503) return { kind: 'unconfigured', message };
  }
  // fetch rejects with a TypeError when the request never got an answer.
  if (isOffline() || error instanceof TypeError || message === 'feed disconnected') {
    return { kind: 'offline', message };
  }
  return { kind: 'error', message };
}
