import { afterEach, describe, expect, it, vi } from 'vitest';
import effrFixture from './fixtures/effr.json';
import treasuryCsv from './fixtures/treasury-2026.csv?raw';
import {
  basisPoints,
  curveOn,
  mergeCurves,
  parseRefRates,
  parseTreasuryCsv,
  targetPath,
} from './parse';
import { loadRates, useRatesStore } from './store';

describe('Treasury yield curve', () => {
  const days = parseTreasuryCsv(treasuryCsv);

  it('reads the Treasury CSV, oldest first, by tenor', () => {
    expect(days.map((day) => day.date)).toEqual([
      '2026-10-16',
      '2026-10-19',
      '2026-10-20',
      '2026-11-09',
      '2026-11-10',
      '2026-11-12',
      '2026-11-13',
      '2026-11-16',
    ]);
    expect(days.at(-1)?.yields).toMatchObject({ '1M': 4.1, '2Y': 4.83, '10Y': 5.12, '30Y': 5.46 });
  });

  it('keeps a missing reading as missing, not zero', () => {
    const [day] = parseTreasuryCsv('Date,"1 Mo","2 Yr"\n01/02/2025,,4.25');
    expect(day?.yields['1M']).toBeNull();
    expect(day?.yields['2Y']).toBe(4.25);
  });

  it('finds the curve on or before a date and measures changes in basis points', () => {
    expect(curveOn(days, '2026-11-11')?.date).toBe('2026-11-10');
    expect(curveOn(days, '2026-01-01')).toBeUndefined();
    expect(basisPoints(5.12, 4.98)).toBe(14);
    expect(basisPoints(5.12, null)).toBeNull();
    expect(mergeCurves(days.slice(0, 3), days.slice(2)).length).toBe(days.length);
  });
});

describe('New York Fed reference rates', () => {
  const effr = parseRefRates(effrFixture);

  it('reads EFFR with its target range, oldest first', () => {
    expect(effr.map((day) => day.date)).toEqual(effr.map((day) => day.date).sort());
    expect(effr.at(-1)).toMatchObject({
      date: '2026-11-16',
      rate: 3.88,
      targetFrom: 3.75,
      targetTo: 4,
    });
  });

  it('turns the daily target range into its changes', () => {
    expect(targetPath(effr)).toEqual([
      { date: effr[0]?.date, from: 3.5, to: 3.75, moveBp: null },
      expect.objectContaining({ from: 3.75, to: 4, moveBp: 25 }),
    ]);
  });
});

describe('loadRates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useRatesStore.setState({
      state: 'loading',
      curve: [],
      sofr: [],
      effr: [],
      failure: undefined,
      loadedAt: null,
    });
  });

  it('keeps the curve when the New York Fed fails, and says why', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.startsWith('https://home.treasury.gov/')
            ? new Response(treasuryCsv, { status: 200 })
            : new Response('{}', { status: 503 }),
        ),
      ),
    );
    await loadRates(Date.parse('2026-11-17T12:00:00Z'));
    const state = useRatesStore.getState();
    expect(state.state).toBe('ready');
    expect(state.curve.at(-1)?.date).toBe('2026-11-16');
    expect(state.effr).toEqual([]);
    expect(state.failure).toBeDefined();
  });
});
