/**
 * The project's edge Worker (apps/edge): keyless public data — news RSS, FRED, SEC — cached at the
 * edge. No user key is ever sent here. Override at build time with VITE_EDGE_URL.
 */
export const EDGE_URL: string =
  (import.meta.env.VITE_EDGE_URL as string | undefined) ??
  'https://open-terminal-edge.marketmesh-api.workers.dev';

/** A non-2xx answer from the edge, with the reason it gave (e.g. "FRED key not configured"). */
export class EdgeError extends Error {
  override name = 'EdgeError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** GET a JSON route from the edge. */
export async function edgeJson(path: string): Promise<unknown> {
  const response = await fetch(`${EDGE_URL}${path}`);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `HTTP ${String(response.status)}`;
    throw new EdgeError(response.status, reason);
  }
  return body;
}
