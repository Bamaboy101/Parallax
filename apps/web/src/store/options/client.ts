import { credentials } from '../../feeds/adapters/alpaca';
import { RequestError, retryAtFrom } from '../failure';

/** Alpaca market data. Options use the indicative feed: the one the free plan includes. */
export const DATA_ORIGIN = 'https://data.alpaca.markets';
export const OPTIONS_FEED = 'indicative';

export class DataOnlyError extends Error {
  override name = 'DataOnlyError';
}

/** A market-data URL; anything that would leave Alpaca's data host is refused. */
export function dataUrl(path: string, params: Readonly<Record<string, string>> = {}): URL {
  if (!/^\/(v2\/stocks|v1beta1\/options)\//.test(path)) {
    throw new DataOnlyError(`Not a market data path: ${path}`);
  }
  const url = new URL(path, DATA_ORIGIN);
  if (url.origin !== DATA_ORIGIN) throw new DataOnlyError('Alpaca market data only');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url;
}

function messageOf(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body;
    if (typeof message === 'string' && message !== '') return message;
  }
  if (status === 401 || status === 403) return 'Alpaca did not accept the saved key';
  return `Alpaca answered HTTP ${String(status)}`;
}

/** GET from Alpaca market data with the user's vault key ('KEY_ID:SECRET'). */
export async function dataRequest(
  storedKey: string,
  path: string,
  params: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const auth = credentials(storedKey);
  if (!auth) throw new RequestError('The saved Alpaca key is incomplete', 401, null);
  const response = await fetch(dataUrl(path, params), {
    headers: { 'APCA-API-KEY-ID': auth.key, 'APCA-API-SECRET-KEY': auth.secret },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RequestError(
      messageOf(body, response.status),
      response.status,
      response.status === 429 ? retryAtFrom(response.headers.get('Retry-After')) : null,
    );
  }
  return body;
}
