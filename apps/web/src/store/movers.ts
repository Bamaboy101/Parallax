import { useEffect, useMemo } from 'react';
import type { Bar } from '../feeds/types';
import { cachedHistory, loadHistory } from './history';
import {
  lastPriceOf,
  priceChannel,
  priceHistorySpan,
  priceLine,
  PRICE_HISTORY_REFRESH_MS,
} from './hooks';
import { INSTRUMENTS, type Instrument } from './symbols';
import { recentValues, REWIND_MS, useTickStore, valueAt, type TickState } from './ticks';

/** Rows per list. */
export const MOVERS_TOP = 5;
/** Ring-buffer reads per symbol when totalling trades: an hour of the busiest pair fits. */
const TRADE_SCAN = 100_000;

export interface Mover {
  item: Instrument;
  price: number;
  /** Same definition as the watchlist: 24 hours for crypto and FX, previous close for stocks. */
  changePct: number | undefined;
  /** Dollars traded in the window this page has seen (USDT counted as USD). */
  tradedUsd: number;
  source: string;
}

export interface MoversView {
  /** Every catalogue symbol with a price in the store. */
  universe: Mover[];
  gainers: Mover[];
  losers: Mover[];
  active: Mover[];
  breadth: { up: number; down: number; flat: number };
}

/**
 * Movers across everything the store has a price for at moment `at` (now, or the Rewind
 * cursor). Reads only: nothing here subscribes, so the board covers what the other panels stream.
 */
export function computeMovers(
  state: TickState,
  barsOf: (item: Instrument) => readonly Bar[] | undefined,
  at: number,
): MoversView {
  const universe = INSTRUMENTS.flatMap((item): Mover[] => {
    const tick = valueAt(state, priceChannel(item), item.id);
    if (!tick) return [];
    const last = lastPriceOf(tick);
    const line = priceLine(item, last, barsOf(item) ?? []);
    let tradedUsd = 0;
    if (item.quote === 'USD' || item.quote === 'USDT') {
      for (const trade of recentValues('trade', item.id, TRADE_SCAN, state.cursor)) {
        if (trade.receivedAt < at - REWIND_MS) break;
        tradedUsd += trade.price * trade.size;
      }
    }
    return [{ item, price: last.price, changePct: line.changePct, tradedUsd, source: last.source }];
  });
  const withChange = universe.filter((mover) => mover.changePct !== undefined);
  const byChange = [...withChange].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  return {
    universe,
    gainers: byChange.filter((mover) => (mover.changePct ?? 0) > 0).slice(0, MOVERS_TOP),
    losers: byChange
      .filter((mover) => (mover.changePct ?? 0) < 0)
      .reverse()
      .slice(0, MOVERS_TOP),
    active: universe
      .filter((mover) => mover.tradedUsd > 0)
      .sort((a, b) => b.tradedUsd - a.tradedUsd)
      .slice(0, MOVERS_TOP),
    breadth: {
      up: withChange.filter((mover) => (mover.changePct ?? 0) > 0).length,
      down: withChange.filter((mover) => (mover.changePct ?? 0) < 0).length,
      flat: withChange.filter((mover) => mover.changePct === 0).length,
    },
  };
}

/**
 * Movers and breadth at `at`, recomputed whenever the caller's clock (or the Rewind cursor)
 * moves. Symbols whose price history is not cached yet get it loaded once, then refreshed with
 * everyone else's every 15 minutes.
 */
export function useMovers(at: number): MoversView {
  const cursor = useTickStore((state) => state.cursor);
  const view = useMemo(
    () =>
      computeMovers(
        useTickStore.getState(),
        (item) => cachedHistory(item, '1h', priceHistorySpan(item))?.bars,
        at,
      ),
    // `cursor` is read through getState; it is a dependency so Rewind recomputes at once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [at, cursor],
  );
  const ids = view.universe.map((mover) => mover.item.id).join(',');
  /** Changes every refresh period, so stale histories are reloaded even if the set holds. */
  const refreshSlot = Math.floor(at / PRICE_HISTORY_REFRESH_MS);
  useEffect(() => {
    const now = Date.now();
    for (const mover of view.universe) {
      const span = priceHistorySpan(mover.item);
      const entry = cachedHistory(mover.item, '1h', span);
      const stale =
        entry?.loadedAt !== undefined && now - entry.loadedAt > PRICE_HISTORY_REFRESH_MS;
      if (!entry || stale) loadHistory(mover.item, '1h', span);
    }
    // The universe's ids and the refresh slot decide what to load; `view` changes every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, refreshSlot]);
  return view;
}
