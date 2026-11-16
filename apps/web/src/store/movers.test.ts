import { afterEach, describe, expect, it } from 'vitest';
import type { Bar, FeedEvent } from '../feeds/types';
import { computeMovers } from './movers';
import { ingest, resetTicks, useTickStore } from './ticks';

const now = Date.now();
const trade = (symbol: string, price: number, size: number, ago = 1000): FeedEvent => ({
  channel: 'trade',
  symbol,
  source: 'test',
  ts: now - ago,
  receivedAt: now - ago,
  price,
  size,
});
/** A day of hourly bars opening at `open`: crypto change is measured from the first open. */
const day = (open: number): Bar[] => [
  { ts: now - 23 * 3_600_000, open, high: open, low: open, close: open, volume: 1 },
];

afterEach(() => {
  resetTicks();
});

describe('computeMovers', () => {
  it('ranks gainers, losers and dollars traded, and counts breadth', () => {
    ingest([
      // Arrival order, as from the hub: the older BTC print first.
      trade('BTC-USD', 66_000, 1, 2 * 3_600_000), // older than the hour: not counted
      trade('BTC-USD', 66_000, 2), // +10% on 60k; $132k traded
      trade('ETH-USD', 1_900, 1), // -5% on 2k
      trade('SOL-USD', 70, 10), // flat
      trade('XRP-USD', 1, 5), // no history yet: no change, still traded
      {
        channel: 'quote',
        symbol: 'EUR-USD',
        source: 'test',
        ts: now,
        receivedAt: now,
        bid: 1.1,
        bidSize: 1,
        ask: 1.1002,
        askSize: 1,
      },
    ]);
    const bars: Record<string, Bar[]> = {
      'BTC-USD': day(60_000),
      'ETH-USD': day(2_000),
      'SOL-USD': day(70),
      'EUR-USD': day(1.1),
    };
    const view = computeMovers(useTickStore.getState(), (item) => bars[item.id], now);

    expect(view.universe.map((mover) => mover.item.id).sort()).toEqual(
      ['BTC-USD', 'ETH-USD', 'EUR-USD', 'SOL-USD', 'XRP-USD'].sort(),
    );
    expect(view.gainers.map((mover) => mover.item.id)).toEqual(['BTC-USD', 'EUR-USD']);
    expect(view.gainers[0]?.changePct).toBeCloseTo(10, 6);
    expect(view.losers.map((mover) => mover.item.id)).toEqual(['ETH-USD']);
    expect(view.active.map((mover) => [mover.item.id, mover.tradedUsd])).toEqual([
      ['BTC-USD', 132_000],
      ['ETH-USD', 1_900],
      ['SOL-USD', 700],
      ['XRP-USD', 5],
    ]);
    // XRP has no change yet, so it is not counted either way.
    expect(view.breadth).toEqual({ up: 2, down: 1, flat: 1 });
  });

  it('is empty when nothing is streaming', () => {
    const view = computeMovers(useTickStore.getState(), () => undefined, now);
    expect(view).toMatchObject({ universe: [], gainers: [], losers: [], active: [] });
    expect(view.breadth).toEqual({ up: 0, down: 0, flat: 0 });
  });
});
