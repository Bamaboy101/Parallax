import type { SymbolRef } from '../feeds/types';
import { logReturns, priceGrid, stdev } from './sampling';

/** Prices are sampled every 10 s over the last hour. */
export const WEATHER_STEP_MS = 10_000;
const BASELINE_SAMPLES = 360;
/** The last 5 minutes, compared with the hour. */
const RECENT_RETURNS = 30;
const MIN_BASELINE_RETURNS = 60;

export type WeatherLabel = 'calm' | 'steady' | 'active' | 'stormy';

export interface Weather {
  /** 0 (still, cool) to 1 (stormy, warm): drives the glow. */
  score: number;
  label: WeatherLabel;
  /** Median ratio of the last 5 minutes' volatility to the hour's, across symbols. */
  ratio: number;
}

/**
 * How much more a price is moving now than over the hour: the standard deviation of the last 5
 * minutes of 10-second returns over that of the whole hour. Undefined until there is enough data.
 */
export function volatilityRatio(prices: readonly (number | undefined)[]): number | undefined {
  const returns = logReturns(prices).filter((value) => value !== undefined);
  if (returns.length < MIN_BASELINE_RETURNS) return undefined;
  const baseline = stdev(returns);
  const recent = stdev(returns.slice(-RECENT_RETURNS));
  if (!baseline || recent === undefined) return undefined;
  return recent / baseline;
}

/** The desk's weather from per-symbol volatility ratios; undefined with no data at all. */
export function weatherFrom(ratios: readonly number[]): Weather | undefined {
  if (ratios.length === 0) return undefined;
  const sorted = [...ratios].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const ratio =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  const label: WeatherLabel =
    ratio < 0.8 ? 'calm' : ratio < 1.25 ? 'steady' : ratio < 2 ? 'active' : 'stormy';
  const score = Math.min(1, Math.max(0, (ratio - 0.6) / (2.4 - 0.6)));
  return { score, label, ratio };
}

/** The weather for a set of symbols at a moment (live or the Rewind cursor). */
export function marketWeather(symbols: readonly SymbolRef[], at: number): Weather | undefined {
  const ratios = symbols.flatMap((symbol) => {
    const ratio = volatilityRatio(priceGrid(symbol, at, WEATHER_STEP_MS, BASELINE_SAMPLES));
    return ratio === undefined ? [] : [ratio];
  });
  return weatherFrom(ratios);
}
