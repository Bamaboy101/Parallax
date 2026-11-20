import { describe, expect, it } from 'vitest';
import { buildContext } from './copilot/context';
import { energyStat, parseEnergy, type EnergySeries } from './energy';
import { useTickStore } from './ticks';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Six years of Fridays. Every week builds 1,000 (thousand barrels); in the same week of each of the
 * five earlier years (52 weeks apart) it built 3,000, and this year it built 10,000.
 */
function weekly(): EnergySeries {
  const last = Date.parse('2026-11-06T00:00:00Z');
  const observations: { date: string; value: number }[] = [];
  let value = 400_000;
  for (let week = 6 * 52; week >= 0; week -= 1) {
    const sameWeek = week > 0 && week % 52 === 0 && week <= 5 * 52;
    value += week === 0 ? 10_000 : sameWeek ? 3_000 : 1_000;
    observations.push({ date: iso(last - week * 7 * DAY), value });
  }
  return { cadence: 'weekly', description: 'Crude stocks', units: 'MBBL', observations };
}

describe('energyStat', () => {
  it("compares the week's change with the same week of the previous five years", () => {
    const stat = energyStat(weekly());
    expect(stat?.asOf).toBe('2026-11-06');
    expect(stat?.change).toBe(10_000);
    expect(stat?.normYears).toBe(5);
    // The same week built 3,000 in each of the five earlier years: 10,000 is 7,000 more than usual.
    expect(stat?.vsNorm).toBe(7_000);
  });

  it('gives no seasonal comparison for daily prices or a short history', () => {
    const daily: EnergySeries = {
      cadence: 'daily',
      description: 'WTI',
      units: '$/BBL',
      observations: [
        { date: '2026-11-10', value: 88 },
        { date: '2026-11-11', value: 89.62 },
      ],
    };
    expect(energyStat(daily)).toMatchObject({ value: 89.62, vsNorm: undefined });
    expect(energyStat(daily)?.change).toBeCloseTo(1.62);
    const short = { ...weekly(), observations: weekly().observations.slice(-100) };
    expect(energyStat(short)?.vsNorm).toBeUndefined();
  });

  it('reads the edge answer and drops anything unreadable', () => {
    expect(parseEnergy({ nope: 1 })).toBeNull();
    expect(
      parseEnergy({
        series: {
          'PET.RWTC.D': {
            cadence: 'daily',
            units: '$/BBL',
            observations: [{ date: '2026-11-11', value: 89.62 }, { date: 'x' }],
          },
        },
      }),
    ).toEqual({
      'PET.RWTC.D': {
        cadence: 'daily',
        description: '',
        units: '$/BBL',
        observations: [{ date: '2026-11-11', value: 89.62 }],
      },
    });
  });

  it('hands the co-pilot the rows the panel shows, scaled to its units', () => {
    const {
      items: [item],
    } = buildContext({
      panels: [{ component: 'energy', title: 'Energy', params: {} }],
      ticks: useTickStore.getState(),
      barsOf: () => undefined,
      events: [],
      midpoints: {},
      paper: null,
      headlines: [],
      fred: null,
      releases: null,
      rates: { curve: [], sofr: [], effr: [] },
      energy: { 'PET.WCESTUS1.W': weekly() },
      now: Date.now(),
    });
    expect(item?.label).toBe('Energy');
    expect(item?.detail).toContain('US energy (EIA): Crude stocks (ex-SPR)');
    expect(item?.detail).toContain('M bbl, +10.0 on the week, +7.0 against the average change');
    expect(item?.detail).toContain('previous 5 years (as of 2026-11-06)');
  });
});
