import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Headline } from './rss';
import bbc from './fixtures/bbc.xml?raw';
import fed from './fixtures/fed.xml?raw';
import { handle, originAllowed } from './index';
import { filterNews, type Env } from './routes';

const SITE = 'https://open-terminal.pages.dev';
const ENV: Env = {
  ALLOWED_ORIGINS: `http://localhost:5173,${SITE},https://*.open-terminal.pages.dev`,
  FRED_API_KEY: 'fred-secret-key',
  SEC_USER_AGENT: 'Open Terminal admin@example.com',
};

/** An in-memory stand-in for the edge cache. */
function memoryCache() {
  const store = new Map<string, Response>();
  return {
    match: (request: Request) => Promise.resolve(store.get(request.url)?.clone()),
    put: (request: Request, response: Response) => {
      store.set(request.url, response.clone());
      return Promise.resolve();
    },
  };
}

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  vi.stubGlobal('caches', { default: memoryCache() });
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const get = (path: string, origin: string | null = SITE) =>
  handle(
    new Request(`https://edge.example${path}`, { headers: origin ? { Origin: origin } : {} }),
    ENV,
  );

describe('origin check', () => {
  it('allows the listed origins and their preview subdomains only', () => {
    expect(originAllowed(SITE, ENV.ALLOWED_ORIGINS)).toBe(true);
    expect(originAllowed('https://v2-visual.open-terminal.pages.dev', ENV.ALLOWED_ORIGINS)).toBe(
      true,
    );
    expect(originAllowed('https://evil-open-terminal.pages.dev', ENV.ALLOWED_ORIGINS)).toBe(false);
    expect(originAllowed('https://open-terminal.pages.dev.evil.com', ENV.ALLOWED_ORIGINS)).toBe(
      false,
    );
  });

  it('refuses requests without an allowed Origin', async () => {
    expect((await get('/news', null)).status).toBe(403);
    expect((await get('/news', 'https://example.com')).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers preflight for an allowed origin', async () => {
    const response = await handle(
      new Request('https://edge.example/fred', { method: 'OPTIONS', headers: { Origin: SITE } }),
      ENV,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
  });
});

describe('/fred', () => {
  it('returns numeric observations, caches for an hour and never exposes the key', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        observations: [
          { date: '2026-11-12', value: '4.11' },
          { date: '2026-11-13', value: '.' },
        ],
      }),
    );
    const first = await get('/fred?series=DGS10&start=2026-11-01');
    const text = await first.text();
    expect(JSON.parse(text)).toEqual({ series: { DGS10: [{ date: '2026-11-12', value: 4.11 }] } });
    expect(text).not.toContain('fred-secret-key');
    expect(first.headers.get('X-Edge-Cache')).toBe('MISS');
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('observation_start=2026-11-01');

    const second = await get('/fred?series=DGS10&start=2026-11-01');
    expect(second.headers.get('X-Edge-Cache')).toBe('HIT');
    expect(second.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('spends the key only on the Macro board series', async () => {
    const response = await get('/fred?series=DGS10,SP500');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unknown series: SP500' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing key as not configured', async () => {
    const response = await handle(
      new Request('https://edge.example/fred?series=DGS10', { headers: { Origin: SITE } }),
      { ...ENV, FRED_API_KEY: undefined },
    );
    expect(response.status).toBe(503);
  });
});

describe('/news', () => {
  it('merges the feeds newest first, filters per query, and fetches once per window', async () => {
    fetchMock.mockImplementation((input) => {
      const url = input instanceof Request ? input.url : input.toString();
      return Promise.resolve(
        url.includes('bbci')
          ? new Response(bbc)
          : url.includes('federalreserve')
            ? new Response(fed)
            : new Response('', { status: 500 }),
      );
    });
    const all = await (
      await get('/news')
    ).json<{
      items: Headline[];
      sources: { name: string; ok: boolean }[];
    }>();
    expect(all.items).toHaveLength(6);
    const times = all.items.map((item) => item.published);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(all.sources.filter((source) => source.ok).map((source) => source.name)).toEqual([
      'BBC Business',
      'Federal Reserve',
    ]);

    const calls = fetchMock.mock.calls.length;
    const word = all.items[0]?.title.split(' ')[0] ?? '';
    const filtered = await (
      await get(`/news?q=${encodeURIComponent(word)}`)
    ).json<{
      items: Headline[];
    }>();
    expect(filtered.items.length).toBeGreaterThan(0);
    for (const item of filtered.items) {
      expect(`${item.title} ${item.summary}`.toLowerCase()).toContain(word.toLowerCase());
    }
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

describe('filterNews', () => {
  const item = (title: string): Headline => ({
    title,
    url: 'https://example.com',
    source: 'Test',
    published: 0,
    summary: '',
  });

  it('matches the start of words, so short queries do not hit inside other words', () => {
    const body = {
      items: [item('AI chips rally'), item('Powell said rates hold'), item('Fed minutes')],
      sources: [],
    };
    expect(filterNews(body, 'ai').items.map((i) => i.title)).toEqual(['AI chips rally']);
    expect(filterNews(body, 'fed').items.map((i) => i.title)).toEqual(['Fed minutes']);
    expect(filterNews(body, '  ').items).toHaveLength(3);
  });
});

describe('/sec', () => {
  it('lists recent filings with document links, declaring the contact user agent', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        name: 'Apple Inc.',
        tickers: ['AAPL'],
        filings: {
          recent: {
            form: ['8-K'],
            filingDate: ['2026-11-09'],
            accessionNumber: ['0001140361-26-041234'],
            primaryDocument: ['ef20051234_8k.htm'],
            primaryDocDescription: ['8-K'],
          },
        },
      }),
    );
    const response = await get('/sec?cik=320193');
    expect(await response.json()).toEqual({
      cik: '320193',
      name: 'Apple Inc.',
      tickers: ['AAPL'],
      filings: [
        {
          form: '8-K',
          filed: '2026-11-09',
          description: '8-K',
          url: 'https://www.sec.gov/Archives/edgar/data/320193/000114036126041234/ef20051234_8k.htm',
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
    expect(init.headers).toMatchObject({ 'User-Agent': 'Open Terminal admin@example.com' });
  });

  it('refuses to call SEC without a declared contact', async () => {
    const response = await handle(
      new Request('https://edge.example/sec?cik=320193', { headers: { Origin: SITE } }),
      { ...ENV, SEC_USER_AGENT: '' },
    );
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
