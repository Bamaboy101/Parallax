import { RequestError, retryAtFrom } from './failure';

/**
 * The project's edge Worker (apps/edge): keyless public data — news RSS, FRED, SEC — cached at the
 * edge. No user key is ever sent here. Override at build time with VITE_EDGE_URL.
 */
export const EDGE_URL: string =
  (import.meta.env.VITE_EDGE_URL as string | undefined) ??
  'https://open-terminal-edge.marketmesh-api.workers.dev';

/**
 * GET a JSON route from the edge. A non-2xx answer throws a RequestError with the reason the edge
 * gave (e.g. "FRED key not configured") and, on 429, its Retry-After.
 */
export async function edgeJson(path: string): Promise<unknown> {
  const response = await fetch(`${EDGE_URL}${path}`);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `HTTP ${String(response.status)}`;
    throw new RequestError(
      reason,
      response.status,
      response.status === 429 ? retryAtFrom(response.headers.get('Retry-After')) : null,
    );
  }
  return body;
}
