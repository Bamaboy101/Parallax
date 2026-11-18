import { afterEach, describe, expect, it, vi } from 'vitest';
import { world } from './routes';

// Shapes recorded 18 Nov 2026: IMF DataMapper `/countries`, `/indicators` and `/{id}` answers,
// and the World Bank indicator API's [meta, rows] pair (which also lists regions such as WLD).

afterEach(() => {
  vi.unstubAllGlobals();
});

const ANSWERS: Record<string, unknown> = {
  countries: { countries: { USA: { label: 'United States' }, JPN: { label: 'Japan' } } },
  indicators: { indicators: { NGDP_RPCH: { source: 'World Economic Outlook (October 2026)' } } },
  NGDP_RPCH: { values: { NGDP_RPCH: { USA: { '2025': 2.0, '2026': 2.3 }, JPN: { '2026': 0.7 } } } },
  PCPIPCH: { values: { PCPIPCH: { USA: { '2026': 3.6 }, JPN: { '2026': 2 } } } },
  GGXWDG_NGDP: { values: { GGXWDG_NGDP: { USA: { '2026': 126.8 } } } },
};
const WORLD_BANK = [
  { page: 1 },
  [
    { countryiso3code: 'USA', date: '2025', value: 30769700000000 },
    { countryiso3code: 'WLD', date: '2025', value: 111e12 },
    { countryiso3code: 'JPN', date: '2025', value: null },
  ],
];

describe('world', () => {
  it("keeps this year's IMF figures and the World Bank's GDP for economies only", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.startsWith('https://api.worldbank.org/'))
        return Promise.resolve(Response.json(WORLD_BANK));
      const last = url.split('/').at(-1) ?? '';
      return Promise.resolve(Response.json(ANSWERS[last] ?? {}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await world(Date.parse('2026-11-18T00:00:00Z'));
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(result.body).toEqual({
      year: '2026',
      imfEdition: 'World Economic Outlook (October 2026)',
      countries: [
        {
          iso3: 'USA',
          name: 'United States',
          growth: 2.3,
          inflation: 3.6,
          debt: 126.8,
          gdpUsd: 30769700000000,
          gdpYear: '2025',
        },
        {
          iso3: 'JPN',
          name: 'Japan',
          growth: 0.7,
          inflation: 2,
          debt: null,
          gdpUsd: null,
          gdpYear: null,
        },
      ],
    });
  });

  it("passes the IMF's rate limit on as a 429", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '60' } })),
      ),
    );
    await expect(world()).rejects.toMatchObject({ status: 429, retryAfter: '60' });
  });
});
