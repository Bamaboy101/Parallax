import { useEffect } from 'react';
import { create } from 'zustand';
import type { Bar, BarInterval, SymbolRef } from '../feeds/types';
import { requestHistory } from './feedClient';
import { failureOf, type Failure } from './failure';

export interface HistoryEntry {
  state: 'loading' | 'ready' | 'error';
  bars: Bar[];
  /** Why the last load failed; kept beside older bars when a refresh fails. */
  failure?: Failure;
  loadedAt?: number;
}

const useHistoryStore = create<{ entries: Record<string, HistoryEntry> }>()(() => ({
  entries: {},
}));

const inFlight = new Set<string>();

const keyOf = (symbol: SymbolRef, interval: BarInterval, spanMs: number) =>
  `${symbol.id}|${interval}|${String(spanMs)}`;

function setEntry(key: string, entry: HistoryEntry): void {
  useHistoryStore.setState((state) => ({ entries: { ...state.entries, [key]: entry } }));
}

/** Fetch the last `spanMs` of bars through the hub; concurrent calls for one key share a fetch. */
export function loadHistory(symbol: SymbolRef, interval: BarInterval, spanMs: number): void {
  const key = keyOf(symbol, interval, spanMs);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  const previous = useHistoryStore.getState().entries[key];
  if (!previous) setEntry(key, { state: 'loading', bars: [] });
  const now = Date.now();
  requestHistory(symbol, interval, now - spanMs, now)
    .then(
      (bars) => {
        setEntry(key, { state: 'ready', bars, loadedAt: Date.now() });
      },
      (error: unknown) => {
        setEntry(key, {
          // Keep bars from an earlier load rather than blanking a sparkline on a refresh error.
          state: previous?.bars.length ? 'ready' : 'error',
          bars: previous?.bars ?? [],
          failure: failureOf(error),
        });
      },
    )
    .finally(() => {
      inFlight.delete(key);
    });
}

/** Bars for the last `spanMs`, refreshed every `refreshMs` while mounted. */
export function useHistory(
  symbol: SymbolRef,
  interval: BarInterval,
  spanMs: number,
  refreshMs: number,
): HistoryEntry | undefined {
  const { id, kind, base, quote } = symbol;
  useEffect(() => {
    const target = { id, kind, base, quote };
    loadHistory(target, interval, spanMs);
    const timer = window.setInterval(() => {
      loadHistory(target, interval, spanMs);
    }, refreshMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [id, kind, base, quote, interval, spanMs, refreshMs]);
  return useHistoryStore((state) => state.entries[keyOf(symbol, interval, spanMs)]);
}

/** What is cached for a symbol now, without fetching or subscribing. */
export function cachedHistory(
  symbol: SymbolRef,
  interval: BarInterval,
  spanMs: number,
): HistoryEntry | undefined {
  return useHistoryStore.getState().entries[keyOf(symbol, interval, spanMs)];
}

export function resetHistory(): void {
  inFlight.clear();
  useHistoryStore.setState({ entries: {} });
}
