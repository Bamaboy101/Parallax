import { describe, expect, it } from 'vitest';
import { buildContext } from './copilot/context';
import { useTickStore } from './ticks';
import { largestEconomies, parseWorld, quintiles, type WorldCountry } from './world';
import { ISO3_BY_NUMERIC } from './worldIso';

const country = (iso3: string, gdpUsd: number | null, growth: number | null): WorldCountry => ({
  iso3,
  name: iso3,
  growth,
  inflation: 2,
  debt: 60,
  gdpUsd,
  gdpYear: '2025',
});

describe('global macro', () => {
  it('reads the edge answer and drops malformed countries', () => {
    expect(parseWorld({ countries: [] })).toBeNull();
    expect(
      parseWorld({
        year: '2026',
        imfEdition: 'World Economic Outlook (October 2026)',
        countries: [
          {
            iso3: 'USA',
            name: 'United States',
            growth: 2.3,
            inflation: 3.6,
            debt: 126.8,
            gdpUsd: 3.07e13,
            gdpYear: '2025',
          },
          { iso3: 'XXX' },
        ],
      })?.countries,
    ).toEqual([
      {
        iso3: 'USA',
        name: 'United States',
        growth: 2.3,
        inflation: 3.6,
        debt: 126.8,
        gdpUsd: 3.07e13,
        gdpYear: '2025',
      },
    ]);
  });

  it('lists the largest economies by GDP, leaving out those without a figure', () => {
    const list = largestEconomies(
      [
        country('SML', 1e9, 1),
        country('BIG', 3e13, 2),
        country('NONE', null, 3),
        country('MID', 4e12, 4),
      ],
      2,
    );
    expect(list.map((entry) => entry.iso3)).toEqual(['BIG', 'MID']);
  });

  it('shades by quintile, so each of five steps holds about a fifth of the countries', () => {
    const values = Array.from({ length: 100 }, (_, index) => index);
    const scale = quintiles(values);
    expect(scale.edges).toEqual([20, 40, 60, 80]);
    const counts = values.reduce<number[]>((tally, value) => {
      const step = scale.stepOf(value) ?? 0;
      tally[step] = (tally[step] ?? 0) + 1;
      return tally;
    }, []);
    expect(counts).toEqual([20, 20, 20, 20, 20]);
    expect(scale.stepOf(null)).toBeNull();
  });

  it("maps the map's country ids to the codes the IMF and World Bank use", () => {
    // world-atlas ids are ISO numeric strings: 840 United States, 276 Germany, 392 Japan.
    expect(ISO3_BY_NUMERIC['840']).toBe('USA');
    expect(ISO3_BY_NUMERIC['276']).toBe('DEU');
    expect(ISO3_BY_NUMERIC['392']).toBe('JPN');
  });

  it('hands the co-pilot the table the panel shows', () => {
    const [item] = buildContext({
      panels: [{ component: 'worldmacro', title: 'Global macro', params: {} }],
      ticks: useTickStore.getState(),
      barsOf: () => undefined,
      events: [],
      midpoints: {},
      paper: null,
      headlines: [],
      fred: null,
      releases: null,
      options: {},
      rates: { curve: [], sofr: [], effr: [] },
      world: {
        year: '2026',
        imfEdition: 'World Economic Outlook (October 2026)',
        countries: [{ ...country('JPN', 4.4e12, 0.7), name: 'Japan', debt: 199.4 }],
      },
      now: Date.now(),
    });
    expect(item?.detail).toContain('IMF World Economic Outlook (October 2026) estimates for 2026');
    expect(item?.detail).toContain(
      'Japan: growth +0.7%, inflation 2.0%, government debt 199.4% of GDP',
    );
  });
});
