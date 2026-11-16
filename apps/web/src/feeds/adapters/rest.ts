import type { Bar } from '../types';

/**
 * Serialise requests to one provider with a minimum gap between them, so a watchlist loading
 * twenty symbols stays inside the provider's public rate limit.
 */
export function throttle(gapMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task);
    chain = run.then(
      () => new Promise((resolve) => globalThis.setTimeout(resolve, gapMs)),
      () => new Promise((resolve) => globalThis.setTimeout(resolve, gapMs)),
    );
    return run;
  };
}

/**
 * A non-2xx response. `status` lets adapters map 401/403 to FeedAuthError; on 429, `retryAfterMs`
 * is the provider's Retry-After, when it sent one.
 */
export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    host: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${String(status)} from ${host}`);
  }
}

/** Retry-After as milliseconds from now: delta seconds or an HTTP date; null when absent. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * GET JSON. Keys go in `headers` where the provider's CORS allows it. HttpError names only the
 * host, so a key in a query string never reaches a message or a log.
 */
export async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, headers ? { headers } : undefined);
  if (!response.ok) {
    throw new HttpError(
      response.status,
      new URL(url).host,
      response.status === 429 ? retryAfterMs(response.headers.get('Retry-After')) : null,
    );
  }
  return response.json() as Promise<unknown>;
}

/** Merge bars into a longer interval aligned to UTC, e.g. 1h → 4h. Input oldest first. */
export function aggregate(bars: Bar[], intervalMs: number): Bar[] {
  const result: Bar[] = [];
  for (const bar of bars) {
    const ts = Math.floor(bar.ts / intervalMs) * intervalMs;
    const current = result.at(-1);
    if (current?.ts === ts) {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    } else {
      result.push({ ...bar, ts });
    }
  }
  return result;
}

/** Sort oldest first, drop duplicates and anything outside [from, to]. */
export function tidy(bars: Bar[], from: number, to: number): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const bar of bars) if (bar.ts >= from && bar.ts <= to) byTime.set(bar.ts, bar);
  return [...byTime.values()].sort((a, b) => a.ts - b.ts);
}
