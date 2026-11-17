import type { SymbolRef } from '../feeds/types';
import { correlation, logReturns, priceGrid } from './sampling';
import { recentValues } from './ticks';
import { radarAt, radarCount } from './whales';

/** Prices every 5 s over the last 15 minutes. */
export const CONSTELLATION_STEP_MS = 5_000;
export const CONSTELLATION_SAMPLES = 180;
/** Two minutes of shared returns before a correlation counts. */
export const MIN_PAIRS = 24;
const TRADE_LIMIT = 20_000;

export interface Star {
  id: string;
  /** Percent move over the window, undefined until two prices exist. */
  change: number | undefined;
  /** Traded value over the window (price × size); undefined for quote-only FX. */
  value: number | undefined;
  /** F8: whale prints and large liquidations on the coin's perp over the window (0 for FX). */
  whales: number;
}

export interface Sky {
  stars: Star[];
  /** correlations[i][j] between stars i and j, undefined while there is too little data. */
  correlations: (number | undefined)[][];
  /** Shared samples behind the correlations so far, for the "gathering" state. */
  samples: number;
}

/**
 * The constellation at a moment (live or the Rewind cursor): each symbol's move and traded value
 * over the last 15 minutes, and the correlation of every pair's 5-second returns.
 */
export function skyAt(symbols: readonly SymbolRef[], at: number, cursor: number | null): Sky {
  const windowStart = at - CONSTELLATION_STEP_MS * (CONSTELLATION_SAMPLES - 1);
  const series = symbols.map((symbol) =>
    priceGrid(symbol, at, CONSTELLATION_STEP_MS, CONSTELLATION_SAMPLES),
  );
  const returns = series.map(logReturns);
  const stars = symbols.map((symbol, index): Star => {
    const prices = (series[index] ?? []).filter((price) => price !== undefined);
    const first = prices[0];
    const last = prices.at(-1);
    const value =
      symbol.kind === 'fx'
        ? undefined
        : recentValues('trade', symbol.id, TRADE_LIMIT, cursor)
            .filter((trade) => trade.ts >= windowStart)
            .reduce((sum, trade) => sum + trade.price * trade.size, 0);
    return {
      id: symbol.id,
      change: first && last && prices.length > 1 ? (last / first - 1) * 100 : undefined,
      value,
      whales: symbol.kind === 'fx' ? 0 : radarCount(radarAt(symbol, at, cursor)),
    };
  });
  const correlations = returns.map((a, i) =>
    returns.map((b, j) => (i === j ? 1 : correlation(a, b, MIN_PAIRS))),
  );
  const samples = Math.max(
    0,
    ...returns.map((list) => list.filter((value) => value !== undefined).length),
  );
  return { stars, correlations, samples };
}
