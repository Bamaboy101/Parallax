import { parseFeed, type Headline } from './rss';

export interface Env {
  /** Project-owned FRED key, set with `wrangler secret put FRED_API_KEY`. */
  FRED_API_KEY?: string;
  /** Comma-separated origins allowed to call the edge; `https://*.host` matches subdomains. */
  ALLOWED_ORIGINS?: string;
  /** SEC asks every client to declare a name and contact email. */
  SEC_USER_AGENT?: string;
}

/** A route's answer, before CORS and caching headers. */
export interface RouteResult {
  status: number;
  body: unknown;
}

export class RouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Public publisher feeds. Headlines link to the publisher; nothing else is copied. */
export const NEWS_FEEDS: readonly { name: string; url: string }[] = [
  {
    name: 'CNBC',
    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
  },
  { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { name: 'WSJ Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
  { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { name: 'SEC', url: 'https://www.sec.gov/news/pressreleases.rss' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
];

/** Newest items kept per feed, so busy feeds never crowd out the Fed or the SEC. */
const PER_FEED = 25;

export interface NewsBody {
  items: Headline[];
  sources: { name: string; ok: boolean }[];
}

/** A cached news answer read back from JSON. */
export function isNewsBody(value: unknown): value is NewsBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    Array.isArray(value.items) &&
    'sources' in value &&
    Array.isArray(value.sources)
  );
}

/** Latest headlines from every feed, newest first. A failing feed is reported, not fatal. */
export async function allNews(env: Env): Promise<RouteResult> {
  const results = await Promise.all(
    NEWS_FEEDS.map(async (feed) => {
      try {
        const response = await fetch(feed.url, {
          headers: {
            'User-Agent': env.SEC_USER_AGENT ?? 'Open Terminal (+https://open-terminal.pages.dev)',
            Accept: 'application/rss+xml, application/xml',
          },
        });
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const items = parseFeed(await response.text(), feed.name)
          .sort((a, b) => b.published - a.published)
          .slice(0, PER_FEED);
        return { name: feed.name, items, ok: true };
      } catch {
        return { name: feed.name, items: [] as Headline[], ok: false };
      }
    }),
  );
  const body: NewsBody = {
    items: results.flatMap((result) => result.items).sort((a, b) => b.published - a.published),
    sources: results.map(({ name, ok }) => ({ name, ok })),
  };
  return { status: 200, body };
}

/** Keep headlines whose title or summary has a word starting with every word of the query. */
export function filterNews(body: NewsBody, query: string): NewsBody {
  const patterns = query
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  if (patterns.length === 0) return body;
  return {
    items: body.items.filter((item) => {
      const text = `${item.title} ${item.summary}`;
      return patterns.every((pattern) => pattern.test(text));
    }),
    sources: body.sources,
  };
}

/** The series the Macro board uses. The key is never spent on anything else. */
export const FRED_SERIES = new Set([
  'DGS1MO',
  'DGS3MO',
  'DGS6MO',
  'DGS1',
  'DGS2',
  'DGS5',
  'DGS7',
  'DGS10',
  'DGS20',
  'DGS30',
  'CPIAUCSL',
  'CPILFESL',
  'PAYEMS',
  'UNRATE',
  'FEDFUNDS',
  'DFF',
]);
const MAX_SERIES = 10;

export async function fred(params: URLSearchParams, env: Env): Promise<RouteResult> {
  if (!env.FRED_API_KEY) throw new RouteError(503, 'FRED key not configured');
  const series = (params.get('series') ?? '').split(',').filter(Boolean);
  if (series.length === 0 || series.length > MAX_SERIES) {
    throw new RouteError(400, `series: 1 to ${String(MAX_SERIES)} ids`);
  }
  const unknown = series.filter((id) => !FRED_SERIES.has(id));
  if (unknown.length > 0) throw new RouteError(400, `unknown series: ${unknown.join(', ')}`);
  const start = params.get('start') ?? '';
  if (start !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new RouteError(400, 'start: YYYY-MM-DD');
  }
  const key = env.FRED_API_KEY;
  const entries = await Promise.all(
    series.map(async (id) => {
      const url =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&file_type=json` +
        (start ? `&observation_start=${start}` : '') +
        `&api_key=${encodeURIComponent(key)}`;
      const response = await fetch(url);
      // The upstream URL carries the key: report the status only.
      if (!response.ok) throw new RouteError(502, `FRED ${id}: HTTP ${String(response.status)}`);
      const data: { observations?: { date: string; value: string }[] } = await response.json();
      const observations = (data.observations ?? []).flatMap(({ date, value }) => {
        const number = Number(value);
        return value === '.' || !Number.isFinite(number) ? [] : [{ date, value: number }];
      });
      return [id, observations] as const;
    }),
  );
  return { status: 200, body: { series: Object.fromEntries(entries) } };
}

/**
 * Major US releases on FRED's calendar, by FRED release id (fred.stlouisfed.org/release?rid=).
 * FRED lists about 900 release dates a month; the calendar keeps these.
 */
export const CALENDAR_RELEASES: Readonly<Record<number, string>> = {
  50: 'Employment Situation',
  10: 'Consumer Price Index',
  46: 'Producer Price Index',
  53: 'Gross Domestic Product',
  54: 'Personal Income and Outlays',
  9: 'Retail Sales',
  192: 'Job Openings and Labor Turnover',
  13: 'Industrial Production',
  27: 'Housing Starts',
  91: 'Consumer Sentiment (Michigan)',
  180: 'Jobless Claims',
};
/** Days ahead the calendar covers. */
export const CALENDAR_DAYS = 30;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Upcoming major releases, soonest first. FRED lists scheduled dates only with
 * `include_release_dates_with_no_data=true` and a future `realtime_end`; it has dates, not times.
 */
export async function calendar(env: Env, now = Date.now()): Promise<RouteResult> {
  if (!env.FRED_API_KEY) throw new RouteError(503, 'FRED key not configured');
  const from = isoDate(now);
  const to = isoDate(now + CALENDAR_DAYS * 86_400_000);
  const url =
    'https://api.stlouisfed.org/fred/releases/dates?file_type=json' +
    `&realtime_start=${from}&realtime_end=${to}&include_release_dates_with_no_data=true` +
    `&order_by=release_date&sort_order=asc&limit=1000&api_key=${encodeURIComponent(env.FRED_API_KEY)}`;
  const response = await fetch(url);
  // The upstream URL carries the key: report the status only.
  if (!response.ok) throw new RouteError(502, `FRED calendar: HTTP ${String(response.status)}`);
  const data: { release_dates?: { release_id?: number; date?: string }[] } = await response.json();
  const seen = new Set<string>();
  const releases = (data.release_dates ?? []).flatMap(({ release_id: id, date }) => {
    const name = id === undefined ? undefined : CALENDAR_RELEASES[id];
    if (name === undefined || date === undefined || date < from || date > to) return [];
    const key = `${String(id)}|${date}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ date, id, name }];
  });
  releases.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { status: 200, body: { from, to, releases } };
}

const SEC_FILINGS = 20;

export async function sec(params: URLSearchParams, env: Env): Promise<RouteResult> {
  const cik = params.get('cik') ?? '';
  if (!/^\d{1,10}$/.test(cik)) throw new RouteError(400, 'cik: up to 10 digits');
  if (!env.SEC_USER_AGENT?.includes('@')) {
    throw new RouteError(503, 'SEC contact not configured');
  }
  const padded = cik.padStart(10, '0');
  const response = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { 'User-Agent': env.SEC_USER_AGENT, Accept: 'application/json' },
  });
  if (response.status === 404) throw new RouteError(404, `no SEC filer ${cik}`);
  if (!response.ok) throw new RouteError(502, `SEC: HTTP ${String(response.status)}`);
  const data: {
    name?: string;
    tickers?: string[];
    filings?: { recent?: Record<string, string[] | undefined> };
  } = await response.json();
  const recent = data.filings?.recent ?? {};
  const column = (name: string) => recent[name] ?? [];
  const forms = column('form');
  const number = String(Number(cik));
  const filings = forms.slice(0, SEC_FILINGS).map((form, index) => {
    const accession = column('accessionNumber')[index] ?? '';
    const document = column('primaryDocument')[index] ?? '';
    return {
      form,
      filed: column('filingDate')[index] ?? '',
      description: column('primaryDocDescription')[index] ?? '',
      url: `https://www.sec.gov/Archives/edgar/data/${number}/${accession.replaceAll('-', '')}/${document}`,
    };
  });
  return {
    status: 200,
    body: { cik: number, name: data.name ?? '', tickers: data.tickers ?? [], filings },
  };
}
