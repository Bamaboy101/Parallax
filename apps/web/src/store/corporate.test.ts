import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from './copilot/context';
import {
  fetchEarnings,
  largestReporting,
  parseEarnings,
  parseOwnership,
  type Earnings,
} from './corporate';
import finnhubEarnings from './fixtures/finnhub-earnings.json';
import { useTickStore } from './ticks';

// Fixture: six entries of Finnhub's /calendar/earnings for 18 Nov to 2 Dec 2026, recorded 18 Nov.

afterEach(() => {
  vi.unstubAllGlobals();
});

const entry = (symbol: string, date: string, revenueEstimate: number | null): Earnings => ({
  symbol,
  date,
  hour: 'amc',
  quarter: 3,
  year: 2026,
  epsEstimate: 1,
  epsActual: null,
  revenueEstimate,
  revenueActual: null,
});

describe('earnings', () => {
  it("reads Finnhub's calendar soonest first, keeping its hour codes", () => {
    const entries = parseEarnings(finnhubEarnings);
    expect(entries?.[0]).toMatchObject({ symbol: 'WMT', date: '2026-11-19', hour: 'bmo' });
    expect(entries?.map((e) => e.date)).toEqual([...(entries ?? [])].map((e) => e.date).sort());
    expect(parseEarnings({ nope: [] })).toBeNull();
  });

  it('keeps the largest companies by expected revenue for the market-wide list', () => {
    const list = largestReporting(
      [
        entry('SMALL', '2026-11-19', 1e6),
        entry('BIG', '2026-11-25', 9e10),
        entry('MID', '2026-11-20', 5e9),
        entry('NONE', '2026-11-19', null),
      ],
      2,
    );
    expect(list.map((e) => e.symbol)).toEqual(['MID', 'BIG']);
  });

  it('sends the key only to Finnhub, for the two weeks ahead', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(finnhubEarnings));
    vi.stubGlobal('fetch', fetchMock);
    await fetchEarnings('user-token', 'AAPL', Date.parse('2026-11-18T12:00:00Z'));
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin).toBe('https://finnhub.io');
    expect(url.pathname).toBe('/api/v1/calendar/earnings');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '2026-11-18',
      to: '2026-12-02',
      symbol: 'AAPL',
      token: 'user-token',
    });
  });
});

const OWNERSHIP = {
  ticker: 'AAPL',
  name: 'Apple Inc.',
  insiders: [
    {
      filed: '2026-11-12',
      url: 'https://www.sec.gov/x/form4.xml',
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
    },
  ],
  holders: [
    {
      form: 'SCHEDULE 13G',
      filed: '2026-04-29',
      url: 'https://www.sec.gov/x/primary_doc.xml',
      holder: 'Vanguard Capital Management',
      percent: 7.48,
    },
    {
      form: 'SC 13G/A',
      filed: '2024-02-14',
      url: 'https://www.sec.gov/y.htm',
      holder: null,
      percent: null,
    },
  ],
};

describe('ownership', () => {
  it("reads the edge's answer and gives the co-pilot what the panel shows", () => {
    const ownership = parseOwnership(OWNERSHIP);
    expect(ownership?.holders[1]).toMatchObject({ holder: null, percent: null });
    const {
      items: [item],
    } = buildContext({
      panels: [
        { component: 'corporate', title: 'Corporate events · AAPL', params: { symbol: 'AAPL' } },
      ],
      ticks: useTickStore.getState(),
      barsOf: () => undefined,
      events: [],
      midpoints: {},
      paper: null,
      headlines: [],
      fred: null,
      releases: null,
      rates: { curve: [], sofr: [], effr: [] },
      corporate: { AAPL: { ownership } },
      now: Date.now(),
    });
    // Earnings dates are Finnhub's: never sent to the AI provider.
    expect(item?.detail).not.toMatch(/earnings|Finnhub/i);
    expect(item?.detail).toContain(
      '2026-11-10 Newstead Jennifer (SVP, GC and Government Affairs) sell 2,399 shares at 351.36, under a pre-arranged 10b5-1 plan',
    );
    expect(item?.detail).toContain(
      'Vanguard Capital Management 7.48% (SCHEDULE 13G, filed 2026-04-29)',
    );
  });
});
