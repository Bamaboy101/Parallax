import type { Bar, BarInterval } from '../types';

export const INTERVAL_MS: Record<BarInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

/**
 * Serialise requests to one provider with a minimum gap between them, so a watchlist loading
 * twenty symbols stays inside the provider's public rate limit.
 */
export function throttle(gapMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task);
    chain = run.then(
      () => new Promise((resolve) => globalThis.setTimeout(resolve, gapMs)),
      () => new Promise((resolve) => globalThis.setTimeout(resolve, gapMs)),
    );
    return run;
  };
}

export async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} from ${new URL(url).host}`);
  return response.json() as Promise<unknown>;
}

/** Merge bars into a longer interval aligned to UTC, e.g. 1h → 4h. Input oldest first. */
export function aggregate(bars: Bar[], intervalMs: number): Bar[] {
  const result: Bar[] = [];
  for (const bar of bars) {
    const ts = Math.floor(bar.ts / intervalMs) * intervalMs;
    const current = result.at(-1);
    if (current?.ts === ts) {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    } else {
      result.push({ ...bar, ts });
    }
  }
  return result;
}

/** Sort oldest first, drop duplicates and anything outside [from, to]. */
export function tidy(bars: Bar[], from: number, to: number): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const bar of bars) if (bar.ts >= from && bar.ts <= to) byTime.set(bar.ts, bar);
  return [...byTime.values()].sort((a, b) => a.ts - b.ts);
}
