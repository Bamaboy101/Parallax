import { useEffect, useState } from 'react';
import type { LiquidationEvent, SymbolRef, TradeEvent } from '../feeds/types';
import { subscribeFeed } from './feedClient';
import { PERPS, type Perp } from './perps';
import { recentValues, useTickStore } from './ticks';

/**
 * F8 whale radar: trades and liquidations large enough to stand out, as a quiet signal. A trade
 * is a whale when its value clears both a fixed floor and the symbol's own 99.5th percentile over
 * the last hour, so a busy market (BTC) needs a bigger print than a quiet one (AVAX) and a quiet
 * market never calls ordinary trades whales. Liquidations use the floor alone: they are rare
 * enough that a percentile would mean little.
 */

/** Trade or liquidation value, in the quote currency (USD, USDT or USD-quoted stocks). */
export const WHALE_FLOOR = 100_000;
export const WHALE_PERCENTILE = 0.995;
/** Fewer trades than this in the hour: the floor alone decides. */
export const MIN_TRADES_FOR_PERCENTILE = 200;
/** How far back the radar looks. Matches the Constellation's window. */
export const WHALE_WINDOW_MS = 15 * 60_000;
const BASELINE_MS = 60 * 60_000;
const TRADE_LIMIT = 20_000;
const LIQUIDATION_LIMIT = 2_000;

export const notional = (event: { price: number; size: number }): number =>
  event.price * event.size;

/** The value a trade must reach to count, from the hour's trade values. */
export function whaleThreshold(values: readonly number[]): number {
  if (values.length < MIN_TRADES_FOR_PERCENTILE) return WHALE_FLOOR;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.floor(sorted.length * WHALE_PERCENTILE));
  return Math.max(WHALE_FLOOR, sorted[rank] ?? WHALE_FLOOR);
}

/** The perpetual future on the same coin, whose liquidations belong to this symbol's radar. */
export function perpFor(symbol: SymbolRef): Perp | undefined {
  return symbol.kind === 'crypto' ? PERPS.find((perp) => perp.base === symbol.base) : undefined;
}

export interface Radar {
  /** Trade value a print needed to count, in the quote currency. */
  threshold: number;
  /** Whale trades in the window, newest first. */
  trades: TradeEvent[];
  /** Liquidations over the floor in the window on the coin's perp, newest first. */
  liquidations: LiquidationEvent[];
}

/** One symbol's radar at a moment (live or the Rewind cursor). */
export function radarAt(symbol: SymbolRef, at: number, cursor: number | null): Radar {
  const trades = recentValues('trade', symbol.id, TRADE_LIMIT, cursor).filter(
    (trade) => trade.ts > at - BASELINE_MS && trade.ts <= at,
  );
  const threshold = whaleThreshold(trades.map(notional));
  const since = at - WHALE_WINDOW_MS;
  const perp = perpFor(symbol);
  return {
    threshold,
    trades: trades.filter((trade) => trade.ts > since && notional(trade) >= threshold),
    liquidations: perp
      ? recentValues('liquidation', perp.id, LIQUIDATION_LIMIT, cursor).filter(
          (event) => event.ts > since && event.ts <= at && notional(event) >= WHALE_FLOOR,
        )
      : [],
  };
}

/** Whale prints and liquidations together, for a count. */
export const radarCount = (radar: Radar): number => radar.trades.length + radar.liquidations.length;

/** The radar is recomputed this often: a whale is news for minutes, not milliseconds. */
export const RADAR_REFRESH_MS = 5_000;

/** Keep the liquidation feeds of some perps open while mounted, so their history fills. */
export function useLiquidationFeeds(perps: readonly Perp[]): void {
  const key = perps.map((perp) => perp.id).join(',');
  useEffect(() => {
    const releases = key
      .split(',')
      .filter(Boolean)
      .flatMap((id) => {
        const perp = PERPS.find((candidate) => candidate.id === id);
        return perp ? [subscribeFeed(perp, 'liquidation')] : [];
      });
    return () => {
      for (const release of releases) release();
    };
  }, [key]);
}

/** One symbol's radar, every 5 s and whenever Rewind moves; its perp's liquidations stay on. */
export function useRadar(symbol: SymbolRef): Radar {
  const cursor = useTickStore((state) => state.cursor);
  const perp = perpFor(symbol);
  useLiquidationFeeds(perp ? [perp] : []);
  const [radar, setRadar] = useState<Radar>(() => radarAt(symbol, cursor ?? Date.now(), cursor));
  useEffect(() => {
    const update = () => {
      setRadar(radarAt(symbol, cursor ?? Date.now(), cursor));
    };
    update();
    const timer = window.setInterval(update, RADAR_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [symbol, cursor]);
  return radar;
}
