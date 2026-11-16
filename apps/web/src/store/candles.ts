import { useMemo } from 'react';
import {
  INTERVAL_MS,
  type Bar,
  type BarEvent,
  type BarInterval,
  type SymbolRef,
} from '../feeds/types';
import type { Failure } from './failure';
import { useHistory } from './history';
import { useTick } from './hooks';
import { recentValues, useTickStore } from './ticks';

export const INTERVALS: readonly BarInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

const MINUTE_MS = INTERVAL_MS['1m'];
/** Bars of history a chart loads. */
const HISTORY_BARS = 500;
/** History refresh: keeps the live bar's volume in step with the exchange. */
const REFRESH_MS: Record<BarInterval, number> = {
  '1m': MINUTE_MS,
  '5m': MINUTE_MS,
  '15m': MINUTE_MS,
  '1h': 5 * MINUTE_MS,
  '4h': 15 * MINUTE_MS,
  '1d': 15 * MINUTE_MS,
};

/**
 * Fold live 1-minute bars into the chart interval, continuing from history.
 *
 * Prices fold in from every live minute. Volume is added only for minutes that started after the
 * history was fetched (the fetch already counted earlier ones); bars entirely after the history
 * take every minute's volume. The live bar can therefore under-count by at most the volume traded
 * in the minute of the fetch, until the next refresh.
 */
export function foldLive(
  history: readonly Bar[],
  liveMinutes: readonly BarEvent[],
  interval: BarInterval,
  loadedAt: number,
): Bar[] {
  const step = INTERVAL_MS[interval];
  const fetchMinute = Math.floor(loadedAt / MINUTE_MS) * MINUTE_MS;
  const last = history.at(-1);
  const buckets = new Map<number, { bar: Bar; fromHistory: boolean }>();
  for (const minute of liveMinutes) {
    if (minute.ts < fetchMinute) continue;
    const ts = Math.floor(minute.ts / step) * step;
    if (last && ts < last.ts) continue;
    let entry = buckets.get(ts);
    if (!entry) {
      entry =
        last?.ts === ts
          ? { bar: { ...last }, fromHistory: true }
          : {
              bar: {
                ts,
                open: minute.open,
                high: minute.high,
                low: minute.low,
                close: minute.close,
                volume: 0,
              },
              fromHistory: false,
            };
      buckets.set(ts, entry);
    }
    const { bar } = entry;
    bar.high = Math.max(bar.high, minute.high);
    bar.low = Math.min(bar.low, minute.low);
    bar.close = minute.close;
    if (!entry.fromHistory || minute.ts > fetchMinute) bar.volume += minute.volume;
  }
  return [...buckets.values()].map((entry) => entry.bar).sort((a, b) => a.ts - b.ts);
}

export interface Candles {
  state: 'loading' | 'ready' | 'error';
  failure?: Failure;
  /** History, oldest first. A new array only when history reloads. */
  history: readonly Bar[];
  /** Bars at or after the end of history, rebuilt from live 1-minute bars. */
  tail: Bar[];
}

/**
 * Candles for a chart: REST history plus live bars from the stream, at the Rewind cursor or
 * live. While rewound, bars after the cursor are hidden.
 */
export function useCandles(symbol: SymbolRef, interval: BarInterval): Candles {
  const entry = useHistory(
    symbol,
    interval,
    HISTORY_BARS * INTERVAL_MS[interval],
    REFRESH_MS[interval],
  );
  useTick(symbol, 'bar'); // keeps the 1-minute bar stream open
  const version = useTickStore((state) => state.versions.bar[symbol.id] ?? 0);
  const cursor = useTickStore((state) => state.cursor);
  const bars = entry?.bars;
  const loadedAt = entry?.loadedAt;

  const history = useMemo(
    () => (bars && cursor !== null ? bars.filter((bar) => bar.ts <= cursor) : (bars ?? [])),
    [bars, cursor],
  );
  const tail = useMemo(() => {
    if (loadedAt === undefined) return [];
    const minutes = recentValues('bar', symbol.id, 1000, cursor).reverse();
    return foldLive(history, minutes, interval, loadedAt);
    // `version` invalidates the memo when a live bar arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, symbol.id, interval, loadedAt, cursor, version]);

  return {
    state: entry?.state ?? 'loading',
    ...(entry?.failure === undefined ? {} : { failure: entry.failure }),
    history,
    tail,
  };
}
