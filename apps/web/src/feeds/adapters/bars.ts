import type { Bar } from '../types';

const MINUTE_MS = 60_000;

/**
 * Live 1-minute bars built from trades, for streams without a bar channel that updates within the
 * minute. One open bar per key; a trade from an already closed minute is dropped.
 */
export class MinuteBars {
  private readonly bars = new Map<string, Bar>();

  /** Fold a trade into its minute. Returns a copy of the updated bar, or undefined if late. */
  fold(key: string, ts: number, price: number, size: number): Bar | undefined {
    const open = Math.floor(ts / MINUTE_MS) * MINUTE_MS;
    let bar = this.bars.get(key);
    if (bar && open < bar.ts) return undefined;
    if (!bar || open > bar.ts) {
      bar = { ts: open, open: price, high: price, low: price, close: price, volume: 0 };
      this.bars.set(key, bar);
    }
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
    bar.close = price;
    bar.volume += size;
    return { ...bar };
  }

  delete(key: string): void {
    this.bars.delete(key);
  }
}
