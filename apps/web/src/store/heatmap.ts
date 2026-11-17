import type { DepthSample } from './ticks';

/**
 * F2 liquidity heatmap: the order book over time as a field of cells behind price. Pure, so the
 * chart layer only maps time and price to the screen and paints.
 */

export interface HeatMapping {
  /** Screen x of a moment (epoch ms), or null when it is off the chart's time scale. */
  xOf: (time: number) => number | null;
  /** Screen y of a price, or null. */
  yOf: (price: number) => number | null;
  width: number;
  height: number;
  /** Cell edge in screen pixels. */
  cell: number;
}

export interface HeatGrid {
  cols: number;
  rows: number;
  cell: number;
  /** Resting value (size × price) per cell, row-major. */
  values: Float32Array;
  max: number;
}

/**
 * Resting liquidity per screen cell. Each depth sample covers the time until the next sample,
 * and each price bin its whole price span. Bins landing in the same cell of one sample add up;
 * a cell keeps the most any sample put there, so a wall that stood for a minute reads the same
 * as one that stood for a second, and a brief one still shows.
 */
export function heatGrid(
  samples: readonly DepthSample[],
  map: HeatMapping,
  /** A buffer to reuse when it is the right size (redrawing every frame while panning). */
  into?: Float32Array,
): HeatGrid {
  const cols = Math.max(0, Math.ceil(map.width / map.cell));
  const rows = Math.max(0, Math.ceil(map.height / map.cell));
  const values = into?.length === cols * rows ? into.fill(0) : new Float32Array(cols * rows);
  let max = 0;
  const sampleRows = new Map<number, number>();
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!sample) continue;
    const start = map.xOf(sample.receivedAt);
    if (start === null) continue;
    const next = samples[index + 1];
    const nextX = next ? map.xOf(next.receivedAt) : null;
    const end = nextX !== null && nextX > start ? nextX : start + map.cell;
    const firstCol = Math.max(0, Math.floor(start / map.cell));
    const lastCol = Math.min(cols - 1, Math.ceil(end / map.cell) - 1);
    if (lastCol < firstCol) continue;

    sampleRows.clear();
    for (const [price, value] of sample.levels) {
      const top = map.yOf(price + sample.bin / 2);
      const bottom = map.yOf(price - sample.bin / 2);
      if (top === null || bottom === null) continue;
      const firstRow = Math.max(0, Math.floor(Math.min(top, bottom) / map.cell));
      const lastRow = Math.min(rows - 1, Math.ceil(Math.max(top, bottom) / map.cell) - 1);
      for (let row = firstRow; row <= lastRow; row += 1) {
        sampleRows.set(row, (sampleRows.get(row) ?? 0) + value);
      }
    }
    for (const [row, value] of sampleRows) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        const at = row * cols + col;
        if (value > (values[at] ?? 0)) values[at] = value;
      }
      if (value > max) max = value;
    }
  }
  return { cols, rows, cell: map.cell, values, max };
}

/**
 * Opacity for a cell: logarithmic, so a wall a hundred times the typical level stands out
 * without flattening everything else; capped so price stays readable on top.
 */
export const HEAT_MAX_ALPHA = 0.55;

export function heatAlpha(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return (Math.log1p(value) / Math.log1p(max)) ** 2 * HEAT_MAX_ALPHA;
}
