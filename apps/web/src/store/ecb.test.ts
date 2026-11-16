import { describe, expect, it } from 'vitest';
import { parseEcb } from './ecb';

// Shape of https://api.frankfurter.dev/v1/2026-11-05..?base=USD (two fixings, three currencies).
const series = {
  amount: 1,
  base: 'USD',
  start_date: '2026-11-13',
  end_date: '2026-11-16',
  rates: {
    '2026-11-16': { EUR: 0.90794, JPY: 159.6, GBP: 0.75767 },
    '2026-11-13': { EUR: 0.9125, JPY: 158.2, GBP: 0.75767 },
  },
};
const names = { EUR: 'Euro', JPY: 'Japanese Yen', GBP: 'British Pound' };

describe('parseEcb', () => {
  it('takes the latest fixing and measures each currency against the dollar', () => {
    const parsed = parseEcb(series, names);
    expect(parsed?.date).toBe('2026-11-16');
    expect(parsed?.rates.map((rate) => rate.code)).toEqual(['EUR', 'GBP', 'JPY']);
    const [eur, gbp, jpy] = parsed?.rates ?? [];
    // Fewer euros per dollar: the euro strengthened.
    expect(eur?.changePct).toBeCloseTo((0.9125 / 0.90794 - 1) * 100, 6);
    expect(eur?.changePct).toBeGreaterThan(0);
    // More yen per dollar: the yen weakened.
    expect(jpy?.changePct).toBeLessThan(0);
    expect(gbp).toMatchObject({ name: 'British Pound', perUsd: 0.75767, changePct: 0 });
  });

  it('has no change with a single fixing, and rejects junk', () => {
    const single = { rates: { '2026-11-16': { EUR: 0.9 } } };
    expect(parseEcb(single, {})?.rates).toEqual([
      { code: 'EUR', name: 'EUR', perUsd: 0.9, changePct: undefined },
    ]);
    expect(parseEcb({ message: 'not found' }, names)).toBeNull();
    expect(parseEcb(null, names)).toBeNull();
  });
});
