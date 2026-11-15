import { useEffect, useMemo } from 'react';
import type { SourceStatus } from '../feeds/protocol';
import type { Channel, SymbolRef } from '../feeds/types';
import { subscribeFeed } from './feedClient';
import { recentValues, setCursor, useTickStore, valueAt, type TickOf } from './ticks';

/** Keep a hub subscription open while the calling component is mounted. */
function useFeedSubscription(symbol: SymbolRef, channel: Channel): void {
  const { id, kind, base, quote } = symbol;
  useEffect(
    () => subscribeFeed({ id, kind, base, quote }, channel),
    [id, kind, base, quote, channel],
  );
}

/**
 * The value of one symbol's channel, at the Rewind cursor or live. Re-renders only when that
 * value changes, so a ticking cell never re-renders its neighbours.
 */
export function useTick<C extends Channel>(symbol: SymbolRef, channel: C): TickOf[C] | undefined {
  useFeedSubscription(symbol, channel);
  return useTickStore((state) => valueAt(state, channel, symbol.id));
}

/** The most recent trades, newest first, at the Rewind cursor or live. */
export function useTrades(symbol: SymbolRef, limit: number): TickOf['trade'][] {
  useFeedSubscription(symbol, 'trade');
  const version = useTickStore((state) => state.versions.trade[symbol.id] ?? 0);
  const cursor = useTickStore((state) => state.cursor);
  return useMemo(
    () => recentValues('trade', symbol.id, limit, cursor),
    // `version` invalidates the memo when new trades arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol.id, limit, cursor, version],
  );
}

/** One feed's connection status, for truth badges. */
export function useSourceStatus(source: string | undefined): SourceStatus | undefined {
  return useTickStore((state) => (source === undefined ? undefined : state.status[source]));
}

/** The Rewind cursor (null = live) and its setter. */
export function useCursor(): [number | null, (time: number | null) => void] {
  return [useTickStore((state) => state.cursor), setCursor];
}
