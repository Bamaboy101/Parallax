import type { SymbolRef } from '../feeds/types';
import { sampleAt } from './ticks';

/**
 * A symbol's price at `count` evenly spaced moments ending at `end`, oldest first: the last trade
 * for crypto and stocks, the bid/ask mid for FX. Undefined before the first recorded price.
 */
export function priceGrid(
  symbol: SymbolRef,
  end: number,
  stepMs: number,
  count: number,
): (number | undefined)[] {
  const times = Array.from({ length: count }, (_, index) => end - (count - 1 - index) * stepMs);
  if (symbol.kind === 'fx') {
    return sampleAt('quote', symbol.id, times).map((quote) =>
      quote ? (quote.bid + quote.ask) / 2 : undefined,
    );
  }
  return sampleAt('trade', symbol.id, times).map((trade) => trade?.price);
}

/** Log returns between neighbours; undefined where either price is missing. */
export function logReturns(prices: readonly (number | undefined)[]): (number | undefined)[] {
  return prices.slice(1).map((price, index) => {
    const before = prices[index];
    return price && before ? Math.log(price / before) : undefined;
  });
}

/** Sample standard deviation, or undefined for fewer than two values. */
export function stdev(values: readonly number[]): number | undefined {
  if (values.length < 2) return undefined;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Pearson correlation over the positions where both series have a value. Undefined with fewer
 * than `minPairs` pairs, or when either side never moves.
 */
export function correlation(
  a: readonly (number | undefined)[],
  b: readonly (number | undefined)[],
  minPairs: number,
): number | undefined {
  const pairs: [number, number][] = [];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const x = a[index];
    const y = b[index];
    if (x !== undefined && y !== undefined) pairs.push([x, y]);
  }
  if (pairs.length < minPairs) return undefined;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of pairs) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  if (varianceX === 0 || varianceY === 0) return undefined;
  return covariance / Math.sqrt(varianceX * varianceY);
}
