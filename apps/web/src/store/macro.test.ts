import { describe, expect, it } from 'vitest';
import { daysBefore, latest, monthlyChange, valueOn, yearOnYear, type Observation } from './macro';

const monthly = (start: number, values: number[]): Observation[] =>
  values.map((value, index) => {
    const month = start + index;
    const year = 2025 + Math.floor((month - 1) / 12);
    return { date: `${String(year)}-${String(((month - 1) % 12) + 1).padStart(2, '0')}-01`, value };
  });

describe('macro figures', () => {
  it('computes CPI year on year against the same month, and its change from the month before', () => {
    // Sep 2025 .. Oct 2026: 14 monthly readings.
    const cpi = monthly(9, [100, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 103, 104]);
    const stat = yearOnYear(cpi);
    expect(stat?.asOf).toBe('2026-10-01');
    expect(stat?.value).toBeCloseTo((104 / 101 - 1) * 100, 6);
    expect(stat?.change).toBeCloseTo((104 / 101 - 1) * 100 - (103 / 100 - 1) * 100, 6);
    expect(yearOnYear(cpi.slice(-6))).toBeUndefined();
  });

  it('reports the latest reading and the monthly change of a level series', () => {
    const payrolls = monthly(1, [159_000, 159_150, 159_120]);
    expect(latest(payrolls)).toEqual({ value: 159_120, change: -30, asOf: '2025-03-01' });
    expect(monthlyChange(payrolls)).toEqual({ value: -30, change: undefined, asOf: '2025-03-01' });
    expect(monthlyChange(payrolls.slice(0, 1))).toBeUndefined();
  });

  it('finds the last observation on or before a date, skipping market holidays', () => {
    const yields: Observation[] = [
      { date: '2026-10-09', value: 4.1 },
      { date: '2026-10-13', value: 4.2 },
    ];
    expect(daysBefore('2026-11-12', 30)).toBe('2026-10-13');
    expect(valueOn(yields, '2026-10-12')).toEqual({ date: '2026-10-09', value: 4.1 });
    expect(valueOn(yields, '2026-10-01')).toBeUndefined();
  });
});
