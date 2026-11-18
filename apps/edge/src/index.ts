import {
  allNews,
  calendar,
  filterNews,
  fred,
  isNewsBody,
  RouteError,
  sec,
  type Env,
  type RouteResult,
} from './routes';

/**
 * Seconds each route's answer is cached at the edge (plan: news 2 min, FRED 1 h, SEC 10 min;
 * the release calendar changes rarely, 6 h).
 */
export const CACHE_SECONDS = { news: 120, fred: 3600, sec: 600, calendar: 21_600 } as const;

type Route = keyof typeof CACHE_SECONDS;

const DEFAULT_ORIGINS =
  'http://localhost:5173,http://127.0.0.1:5173,https://parallax-terminal.pages.dev,https://*.parallax-terminal.pages.dev,https://parallax-markets.pages.dev,https://*.parallax-markets.pages.dev,https://open-terminal.pages.dev,https://*.open-terminal.pages.dev';

/** Whether `origin` is on the list; `https://*.host` allows any subdomain (Pages previews). */
export function originAllowed(origin: string, list: string | undefined): boolean {
  return (list ?? DEFAULT_ORIGINS)
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => {
      if (entry === origin) return true;
      const wildcard = /^(https?:\/\/)\*\.(.+)$/.exec(entry);
      return (
        wildcard !== null &&
        origin.startsWith(wildcard[1] ?? '') &&
        origin.endsWith(`.${wildcard[2] ?? ''}`)
      );
    });
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  // Readable from the page: the cache verdict, and how long to wait after a 429.
  headers.set('Access-Control-Expose-Headers', 'Retry-After, X-Edge-Cache');
  return new Response(response.body, { status: response.status, headers });
}

/**
 * The upstream answer for a route, from the edge cache when fresh. News is cached once,
 * unfiltered, and filtered per request, so every query shares one fetch of the feeds.
 */
async function cached(route: Route, key: URL, load: () => Promise<RouteResult>): Promise<Response> {
  const cache = caches.default;
  const request = new Request(key.toString());
  const hit = await cache.match(request);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('X-Edge-Cache', 'HIT');
    return new Response(hit.body, { status: hit.status, headers });
  }
  const result = await load();
  const response = json(result.status, result.body, {
    'Cache-Control': `public, max-age=${String(CACHE_SECONDS[route])}`,
  });
  if (result.status === 200) await cache.put(request, response.clone());
  const headers = new Headers(response.headers);
  headers.set('X-Edge-Cache', 'MISS');
  return new Response(response.body, { status: response.status, headers });
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin === null || !originAllowed(origin, env.ALLOWED_ORIGINS)) {
    return json(403, { error: 'origin not allowed' });
  }
  if (request.method === 'OPTIONS') {
    return withCors(
      new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' },
      }),
      origin,
    );
  }
  if (request.method !== 'GET') return withCors(json(405, { error: 'GET only' }), origin);

  const route = url.pathname.slice(1);
  try {
    switch (route) {
      case 'news': {
        const response = await cached('news', new URL('/news', url), () => allNews(env));
        const body: unknown = await response.json();
        const answer = isNewsBody(body) ? filterNews(body, url.searchParams.get('q') ?? '') : body;
        return withCors(
          json(response.status, answer, Object.fromEntries(response.headers)),
          origin,
        );
      }
      case 'fred': {
        const key = new URL('/fred', url);
        for (const name of ['series', 'start']) {
          const value = url.searchParams.get(name);
          if (value !== null) key.searchParams.set(name, value);
        }
        return withCors(await cached('fred', key, () => fred(url.searchParams, env)), origin);
      }
      case 'sec': {
        const key = new URL('/sec', url);
        key.searchParams.set('cik', url.searchParams.get('cik') ?? '');
        return withCors(await cached('sec', key, () => sec(url.searchParams, env)), origin);
      }
      case 'calendar':
        return withCors(
          await cached('calendar', new URL('/calendar', url), () => calendar(env)),
          origin,
        );
      default:
        return withCors(json(404, { error: 'unknown route' }), origin);
    }
  } catch (error) {
    if (error instanceof RouteError) {
      const retry: Record<string, string> =
        error.retryAfter === null ? {} : { 'Retry-After': error.retryAfter };
      return withCors(json(error.status, { error: error.message }, retry), origin);
    }
    return withCors(json(502, { error: 'upstream failed' }), origin);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
} satisfies ExportedHandler<Env>;
