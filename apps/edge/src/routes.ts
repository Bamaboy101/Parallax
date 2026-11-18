import { parseFeed, type Headline } from './rss';

export interface Env {
  /** Project-owned FRED key, set with `wrangler secret put FRED_API_KEY`. */
  FRED_API_KEY?: string;
  /** Comma-separated origins allowed to call the edge; `https://*.host` matches subdomains. */
  ALLOWED_ORIGINS?: string;
  /** SEC asks every client to declare a name and contact email. */
  SEC_USER_AGENT?: string;
  /** Project-owned EIA open-data key, set with `wrangler secret put EIA_API_KEY`. */
  EIA_API_KEY?: string;
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
    /** Upstream's Retry-After, passed on with a 429. */
    readonly retryAfter: string | null = null,
  ) {
    super(message);
  }
}

/**
 * A failed upstream answer: its rate limit becomes our 429 (with its Retry-After), so the app can
 * say "rate limited" rather than "broken"; anything else is a 502. The upstream URL may carry a
 * key, so only the status is reported.
 */
export function upstreamError(label: string, response: Response): RouteError {
  if (response.status === 429) {
    return new RouteError(429, `${label}: rate limited`, response.headers.get('Retry-After'));
  }
  return new RouteError(502, `${label}: HTTP ${String(response.status)}`);
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
            'User-Agent':
              env.SEC_USER_AGENT ?? 'Parallax Terminal (+https://parallax-terminal.pages.dev)',
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

/** The series the Macro board and the Rundown use. The key is never spent on anything else. */
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
  // Rundown (E1): the Fed's broad dollar index (H.10) and WTI crude (EIA), both daily and both
  // "Public Domain: Citation Requested" on FRED (checked 18 Nov 2026).
  'DTWEXBGS',
  'DCOILWTICO',
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
      if (!response.ok) throw upstreamError(`FRED ${id}`, response);
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
  if (!response.ok) throw upstreamError('FRED calendar', response);
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
  if (!response.ok) throw upstreamError('SEC', response);
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

/**
 * The Energy panel's EIA series (M4), by EIA's legacy series id: weekly petroleum and gas
 * storage, crude production and refinery use, and the daily WTI and Henry Hub spot prices. U.S.
 * government data, public domain (eia.gov/about/copyrights_reuse.php, checked 18 Nov 2026). The key
 * is spent on nothing else.
 */
export const EIA_SERIES: Readonly<Record<string, 'weekly' | 'daily'>> = {
  'PET.WCESTUS1.W': 'weekly',
  'PET.WGTSTUS1.W': 'weekly',
  'PET.WDISTUS1.W': 'weekly',
  'PET.WCSSTUS1.W': 'weekly',
  'NG.NW2_EPG0_SWO_R48_BCF.W': 'weekly',
  'PET.WCRFPUS2.W': 'weekly',
  'PET.WPULEUS3.W': 'weekly',
  'PET.RWTC.D': 'daily',
  'NG.RNGWHHD.D': 'daily',
};
/**
 * Rows wanted per series, newest first: six years of weeks (the five-year comparison needs the
 * same week five years back) and a month and a half of days. The seriesid endpoint ignores
 * `start` (recorded 18 Nov 2026: it returned 1982 onwards), so the newest rows are asked for by
 * sorting descending with a length.
 */
const EIA_ROWS = { weekly: 6 * 53, daily: 32 } as const;

export async function eia(env: Env): Promise<RouteResult> {
  if (!env.EIA_API_KEY) throw new RouteError(503, 'EIA key not configured');
  const key = env.EIA_API_KEY;
  const entries = await Promise.all(
    Object.entries(EIA_SERIES).map(async ([id, cadence]) => {
      const url =
        `https://api.eia.gov/v2/seriesid/${id}?length=${String(EIA_ROWS[cadence])}` +
        '&sort[0][column]=period&sort[0][direction]=desc' +
        `&api_key=${encodeURIComponent(key)}`;
      const response = await fetch(url);
      if (!response.ok) throw upstreamError(`EIA ${id}`, response);
      const data: {
        response?: { data?: Record<string, unknown>[] };
      } = await response.json();
      const rows = data.response?.data ?? [];
      const first = rows[0] ?? {};
      const text = (value: unknown) => (typeof value === 'string' ? value : '');
      const observations = rows
        .flatMap((row) => {
          const value = Number(row.value);
          return typeof row.period === 'string' && row.value !== null && Number.isFinite(value)
            ? [{ date: row.period, value }]
            : [];
        })
        // Oldest first, as every other series in the app.
        .sort((a, b) => a.date.localeCompare(b.date));
      return [
        id,
        {
          cadence,
          description: text(first['series-description']),
          units: text(first.units) || text(first.unit),
          observations,
        },
      ] as const;
    }),
  );
  return { status: 200, body: { series: Object.fromEntries(entries) } };
}

/* ---------------------------------------------------------------------------------------------
 * Corporate events (M7): insider trades (Form 4) and large holders (Schedule 13D/13G) from SEC
 * EDGAR. Public information that "may be copied or further distributed" (sec.gov privacy and
 * dissemination policy, checked 18 Nov 2026); SEC asks for a declared user agent and no more than
 * 10 requests a second, so documents are fetched five at a time and the answer is cached 10 min.
 * ------------------------------------------------------------------------------------------- */

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
/** The ticker map changes rarely; one copy a day serves every lookup. */
const SEC_TICKERS_SECONDS = 86_400;
/** Form 4s read per company, newest first, and large-holder filings listed. */
const FORM4_READ = 10;
const HOLDER_FILINGS = 8;
const SEC_BATCH = 5;

const secHeaders = (env: Env) => ({
  'User-Agent': env.SEC_USER_AGENT ?? '',
  Accept: 'application/json, application/xml, text/xml',
});

/** A ticker's CIK from SEC's company_tickers.json, kept a day in the edge cache. */
async function tickerCik(ticker: string, env: Env): Promise<number | null> {
  const cache = caches.default;
  const key = new Request('https://edge.internal/sec-tickers');
  let response = await cache.match(key);
  if (!response) {
    const fresh = await fetch(SEC_TICKERS_URL, { headers: secHeaders(env) });
    if (!fresh.ok) throw upstreamError('SEC tickers', fresh);
    response = new Response(await fresh.text(), {
      headers: { 'Cache-Control': `public, max-age=${String(SEC_TICKERS_SECONDS)}` },
    });
    await cache.put(key, response.clone());
  }
  const map: Record<string, { cik_str?: number; ticker?: string } | undefined> =
    await response.json();
  const wanted = ticker.toUpperCase();
  for (const entry of Object.values(map)) {
    if (entry?.ticker === wanted && typeof entry.cik_str === 'number') return entry.cik_str;
  }
  return null;
}

/** The text of the first `<name>` element, trimmed; '' when absent. */
const tag = (xml: string, name: string) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim() ?? '';
/** The `<value>` inside the first `<name>` element (Form 4 wraps most fields this way). */
const valueOf = (xml: string, name: string) => tag(tag(xml, name), 'value') || tag(xml, name);
const truthy = (text: string) => text === 'true' || text === '1';
const xmlText = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");

export interface InsiderTrade {
  date: string;
  /** SEC transaction code: P purchase, S sale, A grant, M option exercise, F tax, G gift… */
  code: string;
  shares: number;
  /** Per share; null when none was reported (grants, gifts). */
  price: number | null;
  /** Acquired (true) or disposed of (false). */
  acquired: boolean;
  /** Shares held after the transaction. */
  after: number | null;
}

export interface InsiderFiling {
  filed: string;
  url: string;
  owner: string;
  /** 'Director', 'CEO', '10% owner'…, joined. */
  role: string;
  /** Made under a pre-arranged Rule 10b5-1 trading plan. */
  plan: boolean;
  trades: InsiderTrade[];
}

/** One Form 4 (ownershipDocument XML) as the panel shows it; null when it is not one. */
export function parseForm4(xml: string, filed: string, url: string): InsiderFiling | null {
  if (!xml.includes('<ownershipDocument>')) return null;
  const relationship = tag(xml, 'reportingOwnerRelationship');
  const role = [
    truthy(tag(relationship, 'isDirector')) ? 'Director' : '',
    truthy(tag(relationship, 'isOfficer'))
      ? xmlText(tag(relationship, 'officerTitle')) || 'Officer'
      : '',
    truthy(tag(relationship, 'isTenPercentOwner')) ? '10% owner' : '',
    truthy(tag(relationship, 'isOther')) ? xmlText(tag(relationship, 'otherText')) || 'Other' : '',
  ]
    .filter(Boolean)
    .join(', ');
  const trades = [
    ...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g),
  ].flatMap(([, block = '']) => {
    const shares = Number(valueOf(block, 'transactionShares'));
    if (!Number.isFinite(shares)) return [];
    const priceText = valueOf(block, 'transactionPricePerShare');
    const price = Number(priceText);
    const afterText = valueOf(block, 'sharesOwnedFollowingTransaction');
    return [
      {
        date: valueOf(block, 'transactionDate'),
        code: tag(block, 'transactionCode'),
        shares,
        // Gifts and grants report a price of 0: there was none.
        price: priceText === '' || !Number.isFinite(price) || price === 0 ? null : price,
        acquired: valueOf(block, 'transactionAcquiredDisposedCode') === 'A',
        after: afterText === '' ? null : Number(afterText),
      },
    ];
  });
  return {
    filed,
    url,
    owner: xmlText(tag(xml, 'rptOwnerName')),
    role,
    plan: truthy(tag(xml, 'aff10b5One')),
    trades,
  };
}

export interface HolderFiling {
  form: string;
  filed: string;
  url: string;
  /** From the XML Schedule 13D/13G (since Dec 2024); older filings are HTML, so null. */
  holder: string | null;
  percent: number | null;
}

/** Run `work` over `items` a few at a time, keeping SEC's request rate down. */
async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += SEC_BATCH) {
    results.push(...(await Promise.all(items.slice(start, start + SEC_BATCH).map(work))));
  }
  return results;
}

/** The machine-readable XML behind a filing's rendered page: 'xslF345X06/form4.xml' → 'form4.xml'. */
const rawDocument = (document: string) => document.replace(/^xsl[^/]+\//, '');

export async function insiders(params: URLSearchParams, env: Env): Promise<RouteResult> {
  const ticker = (params.get('ticker') ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new RouteError(400, 'ticker: a US ticker');
  if (!env.SEC_USER_AGENT?.includes('@')) throw new RouteError(503, 'SEC contact not configured');
  const cik = await tickerCik(ticker, env);
  if (cik === null) throw new RouteError(404, `no SEC filer for ${ticker}`);
  const response = await fetch(
    `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`,
    { headers: secHeaders(env) },
  );
  if (!response.ok) throw upstreamError('SEC', response);
  const data: {
    name?: string;
    filings?: { recent?: Record<string, string[] | undefined> };
  } = await response.json();
  const recent = data.filings?.recent ?? {};
  const column = (name: string) => recent[name] ?? [];
  const filings = column('form').map((form, index) => {
    const accession = column('accessionNumber')[index] ?? '';
    const document = column('primaryDocument')[index] ?? '';
    const folder = `https://www.sec.gov/Archives/edgar/data/${String(cik)}/${accession.replaceAll('-', '')}`;
    return {
      form,
      filed: column('filingDate')[index] ?? '',
      url: `${folder}/${document}`,
      raw: `${folder}/${rawDocument(document)}`,
      xml: document.endsWith('.xml'),
      // An accession number starts with the filer's CIK (or its filing agent's).
      byCompany: Number(accession.split('-')[0]) === cik,
    };
  });
  // A company's submissions also list filings it made about other companies (NVIDIA's 13G on
  // CoreWeave, its Form 4s as a 10% owner): keep those whose issuer is this company.
  const aboutCompany = (xml: string) => Number(tag(xml, 'issuerCik')) === cik;

  const form4s = filings.filter((filing) => filing.form === '4').slice(0, FORM4_READ);
  const insiderFilings = (
    await inBatches(form4s, async (filing) => {
      const answer = await fetch(filing.raw, { headers: secHeaders(env) });
      if (!answer.ok) return null; // One unreadable filing is left out, not fatal.
      const xml = await answer.text();
      return aboutCompany(xml) ? parseForm4(xml, filing.filed, filing.url) : null;
    })
  ).filter((filing): filing is InsiderFiling => filing !== null);

  const holderForms = filings
    .filter((filing) => /^(SC|SCHEDULE) 13[DG](\/A)?$/.test(filing.form) && !filing.byCompany)
    .slice(0, HOLDER_FILINGS + 4);
  const holders = (
    await inBatches(holderForms, async (filing): Promise<HolderFiling | null> => {
      const base = { form: filing.form, filed: filing.filed, url: filing.url };
      if (!filing.xml) return { ...base, holder: null, percent: null };
      const answer = await fetch(filing.raw, { headers: secHeaders(env) });
      if (!answer.ok) return { ...base, holder: null, percent: null };
      const xml = await answer.text();
      if (!aboutCompany(xml)) return null;
      const percent = Number(tag(xml, 'classPercent'));
      return {
        ...base,
        holder: xmlText(tag(xml, 'reportingPersonName')) || null,
        percent: tag(xml, 'classPercent') !== '' && Number.isFinite(percent) ? percent : null,
      };
    })
  )
    .filter((filing): filing is HolderFiling => filing !== null)
    .slice(0, HOLDER_FILINGS);

  return {
    status: 200,
    body: { ticker, cik, name: data.name ?? '', insiders: insiderFilings, holders },
  };
}

/* ---------------------------------------------------------------------------------------------
 * Global macro (M8): GDP growth, inflation and government debt from the IMF's World Economic
 * Outlook (DataMapper API; "Users may download, extract, copy, ... publish, distribute ... Data
 * ... with attribution to the IMF", imf.org/en/About/copyright-and-terms, checked 18 Nov 2026),
 * and GDP in US dollars from the World Bank's World Development Indicators (CC BY 4.0,
 * datacatalog.worldbank.org/public-licenses). Six requests, cached a day: the IMF updates the
 * WEO twice a year, the World Bank its annual figures a few times a year.
 * ------------------------------------------------------------------------------------------- */

const IMF = 'https://www.imf.org/external/datamapper/api/v1';
/** IMF DataMapper indicator ids, by the field the panel uses. */
export const IMF_INDICATORS = {
  growth: 'NGDP_RPCH',
  inflation: 'PCPIPCH',
  debt: 'GGXWDG_NGDP',
} as const;
const WORLD_BANK_GDP =
  'https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&mrnev=1&per_page=400';

export interface WorldCountry {
  /** ISO 3166 alpha-3, as both sources use. */
  iso3: string;
  name: string;
  /** IMF WEO for the current year: real GDP growth and average inflation (%), gross debt (% GDP). */
  growth: number | null;
  inflation: number | null;
  debt: number | null;
  /** World Bank: GDP in current US dollars, for its latest year on record. */
  gdpUsd: number | null;
  gdpYear: string | null;
}

export async function world(now = Date.now()): Promise<RouteResult> {
  const year = String(new Date(now).getUTCFullYear());
  const getJson = async (label: string, url: string): Promise<unknown> => {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw upstreamError(label, response);
    return response.json();
  };
  const [labels, indicators, wb, growthSeries, inflationSeries, debtSeries] = await Promise.all([
    getJson('IMF countries', `${IMF}/countries`),
    getJson('IMF indicators', `${IMF}/indicators`),
    getJson('World Bank', WORLD_BANK_GDP),
    getJson('IMF growth', `${IMF}/${IMF_INDICATORS.growth}`),
    getJson('IMF inflation', `${IMF}/${IMF_INDICATORS.inflation}`),
    getJson('IMF debt', `${IMF}/${IMF_INDICATORS.debt}`),
  ]);

  const record = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const names = record(record(labels).countries);
  /** This year's value for a country in one DataMapper answer: `{ values: { ID: { ISO: { year } } } }`. */
  const pick = (answer: unknown, id: string, iso3: string): number | null => {
    const value = record(record(record(record(answer).values)[id])[iso3])[year];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const gdp = new Map<string, { value: number; year: string }>();
  const rows: unknown = Array.isArray(wb) ? wb[1] : null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const entry = record(row);
    if (typeof entry.countryiso3code === 'string' && typeof entry.value === 'number') {
      gdp.set(entry.countryiso3code, { value: entry.value, year: String(entry.date) });
    }
  }

  // IMF "countries" are economies; the World Bank's list also has regions, kept out by this.
  const countries: WorldCountry[] = Object.entries(names).flatMap(([iso3, label]) => {
    const name = record(label).label;
    if (typeof name !== 'string') return [];
    const growth = pick(growthSeries, IMF_INDICATORS.growth, iso3);
    const inflation = pick(inflationSeries, IMF_INDICATORS.inflation, iso3);
    const debt = pick(debtSeries, IMF_INDICATORS.debt, iso3);
    const usd = gdp.get(iso3);
    if (growth === null && inflation === null && debt === null && !usd) return [];
    return [
      {
        iso3,
        name,
        growth,
        inflation,
        debt,
        gdpUsd: usd?.value ?? null,
        gdpYear: usd?.year ?? null,
      },
    ];
  });
  const edition = record(record(record(indicators).indicators)[IMF_INDICATORS.growth]).source;
  return {
    status: 200,
    body: {
      year,
      imfEdition: typeof edition === 'string' ? edition : 'World Economic Outlook',
      countries,
    },
  };
}
