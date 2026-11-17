import { afterEach, describe, expect, it } from 'vitest';
import { HEAT_MAX_ALPHA, heatAlpha, heatGrid } from './heatmap';
import { depthBin, depthSamples, ingest, resetTicks, trackDepth, type DepthSample } from './ticks';

/** A depth sample at `t` seconds with $1 bins centred on the given prices. */
const sample = (t: number, levels: [number, number][], bin = 1): DepthSample => ({
  receivedAt: t * 1000,
  bin,
  levels,
});

/** One pixel per second across, one pixel per dollar down from 110; 1 px cells. */
const map = {
  xOf: (time: number) => time / 1000,
  yOf: (price: number) => 110 - price,
  width: 10,
  height: 20,
  cell: 1,
};
const at = (grid: ReturnType<typeof heatGrid>, x: number, row: number) =>
  grid.values[row * grid.cols + x] ?? 0;

describe('heatGrid', () => {
  it('fills each sample across the time until the next one', () => {
    // A $1 bin centred on 100.5 spans 100–101, which is row 9 (y 9–10).
    const grid = heatGrid([sample(2, [[100.5, 100]]), sample(5, [[100.5, 200]])], map);
    expect([1, 2, 3, 4, 5, 6].map((x) => at(grid, x, 9))).toEqual([0, 100, 100, 100, 200, 0]);
  });

  it('paints a bin across its whole price span', () => {
    // A $4 bin centred on 100 spans 98–102: rows 8, 9, 10 and 11.
    const grid = heatGrid([sample(0, [[100, 50]], 4)], map);
    expect([7, 8, 9, 10, 11, 12].map((row) => at(grid, 0, row))).toEqual([0, 50, 50, 50, 50, 0]);
  });

  it('keeps the most any sample put in a cell, and skips what falls off the chart', () => {
    const grid = heatGrid(
      [sample(3, [[100.5, 999]]), sample(4, [[100.5, 10]]), sample(5, [[100.5, 30]])],
      { ...map, xOf: (time) => (time < 4000 ? null : time / 1000) },
    );
    expect(at(grid, 4, 9)).toBe(10);
    expect(at(grid, 5, 9)).toBe(30);
    expect(grid.max).toBe(30);
  });
});

describe('heatAlpha', () => {
  it('is zero for nothing, full for the largest and logarithmic between', () => {
    expect(heatAlpha(0, 1000)).toBe(0);
    expect(heatAlpha(1000, 1000)).toBeCloseTo(HEAT_MAX_ALPHA);
    const small = heatAlpha(10, 1000);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(HEAT_MAX_ALPHA / 2);
  });
});

describe('depth sampling', () => {
  afterEach(() => {
    resetTicks();
  });

  it('picks a round bin of about five basis points', () => {
    expect(depthBin(64_000)).toBe(50);
    expect(depthBin(1_800)).toBe(1);
    expect(depthBin(0.95)).toBe(0.0005);
  });

  it('buckets the whole book once a second, only while tracked', () => {
    const book = (receivedAt: number, bids: [number, number][], asks: [number, number][]) => ({
      channel: 'book' as const,
      kind: 'snapshot' as const,
      symbol: 'BTC-USD',
      source: 'test',
      ts: receivedAt,
      receivedAt,
      bids,
      asks,
    });
    ingest([book(1_000, [[64_000, 1]], [[64_010, 1]])]);
    expect(depthSamples('BTC-USD', null)).toEqual([]);

    const stop = trackDepth('BTC-USD');
    ingest([
      book(
        2_000,
        [
          [64_000, 1],
          [63_990, 2],
          [63_900, 1],
        ],
        [[64_010, 1]],
      ),
    ]);
    ingest([book(2_500, [[64_000, 9]], [[64_010, 9]])]); // same second: not sampled again
    const [first, ...rest] = depthSamples('BTC-USD', null);
    expect(rest).toEqual([]);
    expect(first?.bin).toBe(50);
    // 63,990 and 64,000 share the 63,950–64,000 and 64,000–64,050 bins with their neighbours.
    expect(first?.levels).toEqual(
      expect.arrayContaining([
        [64_025, 64_000 + 64_010],
        [63_975, 63_990 * 2],
        [63_925, 63_900],
      ]),
    );
    stop();
    expect(depthSamples('BTC-USD', null)).toEqual([]);
  });
});
