import { RequestError, retryAtFrom } from '../failure';

/**
 * F4 paper trading talks to Alpaca's paper environment and nothing else. Live trading is
 * impossible by construction, not hidden:
 * - this is the only Alpaca trading origin in the code (lint rejects the live host in source);
 * - every request is built here and refused unless its origin is exactly this one;
 * - a key that looks like a live-trading key is never sent anywhere.
 */
export const PAPER_ORIGIN = 'https://paper-api.alpaca.markets';

/** Thrown before any network call when a request could reach something other than paper. */
export class PaperOnlyError extends Error {
  override name = 'PaperOnlyError';
}

/** `/v2/orders` → the paper URL; anything that would leave the paper origin is refused. */
export function paperUrl(path: string): URL {
  if (!path.startsWith('/v2/')) throw new PaperOnlyError(`Not a paper trading path: ${path}`);
  const url = new URL(path, PAPER_ORIGIN);
  if (url.origin !== PAPER_ORIGIN) throw new PaperOnlyError('Paper trading only');
  return url;
}

/**
 * Alpaca issues paper keys starting with PK and live keys with AK. A live key would be refused
 * by the paper endpoint anyway; refusing it here means it is never sent at all.
 */
export const looksLikeLiveKey = (keyId: string): boolean => /^AK/i.test(keyId.trim());

export interface PaperKey {
  id: string;
  secret: string;
}

/** The vault stores Alpaca as 'KEY_ID:SECRET'. */
export function paperKeyOf(stored: string | undefined): PaperKey | null {
  if (stored === undefined) return null;
  const split = stored.indexOf(':');
  if (split <= 0) return null;
  return { id: stored.slice(0, split), secret: stored.slice(split + 1) };
}

/** Alpaca's error body: `{ code, message }`. */
function messageOf(body: unknown, status: number): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof body.message === 'string'
  ) {
    return body.message;
  }
  return `Alpaca paper answered HTTP ${String(status)}`;
}

/** One request to the paper API. Rejects with RequestError carrying Alpaca's message. */
export async function paperRequest(
  key: PaperKey,
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {},
): Promise<unknown> {
  if (looksLikeLiveKey(key.id)) {
    throw new PaperOnlyError(
      'This is a live-trading key. Paper trading needs your Alpaca paper key (PK…).',
    );
  }
  const url = paperUrl(path);
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'APCA-API-KEY-ID': key.id,
      'APCA-API-SECRET-KEY': key.secret,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  const body: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    throw new RequestError(
      messageOf(body, response.status),
      response.status,
      response.status === 429 ? retryAtFrom(response.headers.get('Retry-After')) : null,
    );
  }
  return body;
}
