import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import form4 from './fixtures/form4-aapl.xml?raw';
import schedule13g from './fixtures/schedule13g-aapl.xml?raw';
import { handle } from './index';
import { parseForm4, type Env } from './routes';

// Fixtures recorded 18 Nov 2026: an Apple Form 4 (a sale under a 10b5-1 plan) and Vanguard's
// XML Schedule 13G on Apple.

const SITE = 'https://parallax-terminal.pages.dev';
const ENV: Env = { ALLOWED_ORIGINS: SITE, SEC_USER_AGENT: 'Parallax admin@example.com' };

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

const urlOf = (input: Parameters<typeof fetch>[0]) =>
  input instanceof Request ? input.url : input.toString();

/**
 * Apple's submissions, with two filings that are not about Apple: a 13G Apple filed itself (its
 * accession starts with Apple's CIK) and an XML 13G and Form 4 whose issuer is another company.
 */
const SUBMISSIONS = {
  name: 'Apple Inc.',
  filings: {
    recent: {
      form: ['4', '8-K', 'SCHEDULE 13G', 'SC 13G/A', '4', 'SC 13G', 'SCHEDULE 13G', '4'],
      filingDate: [
        '2026-11-12',
        '2026-11-01',
        '2026-04-29',
        '2024-02-14',
        '2026-11-05',
        '2024-01-10',
        '2026-03-01',
        '2026-02-01',
      ],
      accessionNumber: [
        '0001140361-26-043484',
        '0000320193-26-000100',
        '0002100119-26-000139',
        '0001193125-24-036431',
        '0001140361-26-042149',
        '0000320193-24-000007',
        '0002100119-26-000999',
        '0001140361-26-000888',
      ],
      primaryDocument: [
        'xslF345X06/form4.xml',
        'aapl-8k.htm',
        'xslSCHEDULE_13G_X02/primary_doc.xml',
        'd751537dsc13ga.htm',
        'xslF345X06/form4.xml',
        'apple-13g-on-another.htm',
        'xslSCHEDULE_13G_X02/primary_doc.xml',
        'xslF345X06/form4.xml',
      ],
    },
  },
};

/** The same documents, about NVIDIA instead of Apple. */
const aboutOther = (xml: string) => xml.replaceAll('0000320193', '0001045810');

function secServer(input: Parameters<typeof fetch>[0]): Promise<Response> {
  const url = urlOf(input);
  if (url.endsWith('company_tickers.json'))
    return Promise.resolve(
      Response.json({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } }),
    );
  if (url.includes('/submissions/CIK0000320193.json'))
    return Promise.resolve(Response.json(SUBMISSIONS));
  if (url.endsWith('/000114036126043484/form4.xml')) return Promise.resolve(new Response(form4));
  if (url.endsWith('/000114036126000888/form4.xml'))
    return Promise.resolve(new Response(aboutOther(form4)));
  if (url.endsWith('/000210011926000139/primary_doc.xml'))
    return Promise.resolve(new Response(schedule13g));
  if (url.endsWith('/000210011926000999/primary_doc.xml'))
    return Promise.resolve(new Response(aboutOther(schedule13g)));
  return Promise.resolve(new Response('not found', { status: 404 }));
}

describe('parseForm4', () => {
  it('reads the owner, role, plan and each transaction', () => {
    expect(parseForm4(form4, '2026-11-12', 'https://sec/x')).toEqual({
      filed: '2026-11-12',
      url: 'https://sec/x',
      owner: 'Newstead Jennifer',
      role: 'SVP, GC and Government Affairs',
      plan: true,
      trades: [
        {
          date: '2026-11-10',
          code: 'S',
          shares: 2399,
          price: 351.36,
          acquired: false,
          after: 27598,
        },
      ],
    });
    expect(parseForm4('<html></html>', '', '')).toBeNull();
  });
});

describe('/insiders', () => {
  it('resolves the ticker, reads the Form 4s and XML 13Gs, and lists older holder filings', async () => {
    fetchMock.mockImplementation(secServer);
    const response = await handle(
      new Request('https://edge.example/insiders?ticker=aapl', { headers: { Origin: SITE } }),
      ENV,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=600');
    const body = await response.json<{
      cik: number;
      insiders: { owner: string; url: string }[];
      holders: { form: string; holder: string | null; percent: number | null; url: string }[];
    }>();
    expect(body.cik).toBe(320193);
    // The second Form 4 could not be read (404 here): left out, not fatal.
    expect(body.insiders.map((filing) => filing.owner)).toEqual(['Newstead Jennifer']);
    expect(body.insiders[0]?.url).toBe(
      'https://www.sec.gov/Archives/edgar/data/320193/000114036126043484/xslF345X06/form4.xml',
    );
    expect(body.holders).toEqual([
      {
        form: 'SCHEDULE 13G',
        filed: '2026-04-29',
        url: 'https://www.sec.gov/Archives/edgar/data/320193/000210011926000139/xslSCHEDULE_13G_X02/primary_doc.xml',
        holder: 'Vanguard Capital Management',
        percent: 7.48,
      },
      {
        form: 'SC 13G/A',
        filed: '2024-02-14',
        url: 'https://www.sec.gov/Archives/edgar/data/320193/000119312524036431/d751537dsc13ga.htm',
        holder: null,
        percent: null,
      },
    ]);
    // Every SEC request declares the contact user agent.
    for (const [input, init] of fetchMock.mock.calls) {
      expect(urlOf(input)).toMatch(/^https:\/\/(www|data)\.sec\.gov\//);
      expect(new Headers(init?.headers).get('User-Agent')).toBe('Parallax admin@example.com');
    }
  });

  it('refuses a malformed ticker and reports an unknown one', async () => {
    fetchMock.mockImplementation(secServer);
    const get = (ticker: string) =>
      handle(
        new Request(`https://edge.example/insiders?ticker=${ticker}`, {
          headers: { Origin: SITE },
        }),
        ENV,
      );
    expect((await get('../etc')).status).toBe(400);
    expect((await get('ZZZZ')).status).toBe(404);
  });
});
