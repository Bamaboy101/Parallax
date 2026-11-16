import { afterEach, describe, expect, it } from 'vitest';
import type { QuoteEvent, SymbolRef, TradeEvent } from '../feeds/types';
import { correlation, logReturns, priceGrid, stdev } from './sampling';
import { ingest, resetTicks } from './ticks';
import { volatilityRatio, weatherFrom } from './weather';

const T0 = 1_800_000_000_000;
const BTC: SymbolRef = { id: 'BTC-USD', kind: 'crypto', base: 'BTC', quote: 'USD' };
const EUR: SymbolRef = { id: 'EUR-USD', kind: 'fx', base: 'EUR', quote: 'USD' };

const trade = (price: number, at: number): TradeEvent => ({
  channel: 'trade',
  symbol: 'BTC-USD',
  source: 'coinbase',
  price,
  size: 1,
  ts: at,
  receivedAt: at,
});

const quote = (bid: number, ask: number, at: number): QuoteEvent => ({
  channel: 'quote',
  symbol: 'EUR-USD',
  source: 'kraken',
  bid,
  bidSize: 1,
  ask,
  askSize: 1,
  ts: at,
  receivedAt: at,
});

afterEach(() => {
  resetTicks();
});

describe('priceGrid', () => {
  it('samples the last trade at or before each moment, and the quote mid for FX', () => {
    ingest([trade(100, T0 + 1_000), trade(101, T0 + 7_000), trade(103, T0 + 12_000)]);
    ingest([quote(1.1, 1.2, T0 + 2_000)]);
    // Moments T0, T0+5s, T0+10s, T0+15s.
    expect(priceGrid(BTC, T0 + 15_000, 5_000, 4)).toEqual([undefined, 100, 101, 103]);
    expect(priceGrid(EUR, T0 + 15_000, 5_000, 4).map((v) => v?.toFixed(2))).toEqual([
      undefined,
      '1.15',
      '1.15',
      '1.15',
    ]);
  });
});

describe('statistics', () => {
  it('skips gaps in returns and correlations', () => {
    expect(logReturns([undefined, 100, 110]).map((v) => v?.toFixed(4))).toEqual([
      undefined,
      Math.log(1.1).toFixed(4),
    ]);
    const a = [1, 2, undefined, 4, 5];
    expect(correlation(a, [2, 4, 6, 8, 10], 4)).toBeCloseTo(1);
    expect(correlation(a, [5, 4, 3, 2, 1], 4)).toBeCloseTo(-1);
    expect(correlation(a, [2, 4, 6, 8, 10], 5)).toBeUndefined();
    expect(correlation([1, 1, 1], [1, 2, 3], 2)).toBeUndefined();
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });
});

describe('market weather', () => {
  /** A price path whose last 30 steps swing `burst` times harder than the rest. */
  const path = (burst: number) => {
    const prices = [100];
    for (let step = 1; step < 360; step += 1) {
      const swing = (step % 2 === 0 ? 1 : -1) * 0.001 * (step >= 330 ? burst : 1);
      prices.push((prices.at(-1) ?? 100) * Math.exp(swing));
    }
    return prices;
  };

  it('reads a quiet hour as calm and a late burst as stormy', () => {
    const quiet = volatilityRatio(path(1));
    const burst = volatilityRatio(path(4));
    expect(quiet).toBeCloseTo(1, 1);
    expect(burst).toBeGreaterThan(2);
    expect(weatherFrom([quiet ?? 0, 0.5, 0.6])?.label).toBe('calm');
    expect(weatherFrom([burst ?? 0, burst ?? 0, 1])).toMatchObject({ label: 'stormy', score: 1 });
    expect(weatherFrom([])).toBeUndefined();
  });

  it('waits for ten minutes of returns before judging', () => {
    expect(volatilityRatio(path(1).slice(0, 50))).toBeUndefined();
  });
});
