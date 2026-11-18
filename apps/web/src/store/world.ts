import { useEffect, useState } from 'react';
import { isObject } from '../feeds/adapters/parse';
import { edgeJson } from './edge';
import { failureOf, type Failure } from './failure';
import { freshnessOfFailure, reportRestFreshness } from './panels';

/** The edge caches the answer a day; the IMF publishes the WEO twice a year. */
export const WORLD_REFRESH_MS = 6 * 60 * 60_000;
/** How many economies the table lists, largest first (the plan's "50 countries"). */
export const WORLD_TABLE = 50;

export interface WorldCountry {
  iso3: string;
  name: string;
  growth: number | null;
  inflation: number | null;
  debt: number | null;
  gdpUsd: number | null;
  gdpYear: string | null;
}

export interface WorldData {
  /** The year the IMF figures are for (the current year: WEO estimates). */
  year: string;
  /** e.g. "World Economic Outlook (October 2026)". */
  imfEdition: string;
  countries: readonly WorldCountry[];
}

export type WorldMetric = 'growth' | 'inflation' | 'debt';

interface MetricInfo {
  id: WorldMetric;
  label: string;
  plain: string;
  unit: string;
}

/** What the map can show, the first being the default. */
export const METRICS: readonly [MetricInfo, ...MetricInfo[]] = [
  { id: 'growth', label: 'Real GDP growth', plain: 'How fast the economy grows', unit: '%' },
  { id: 'inflation', label: 'Inflation', plain: 'How fast prices rise', unit: '%' },
  { id: 'debt', label: 'Government debt', plain: 'Government debt', unit: '% of GDP' },
];

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The edge's `/world` answer; null when it is not one. */
export function parseWorld(body: unknown): WorldData | null {
  if (!isObject(body) || !Array.isArray(body.countries) || typeof body.year !== 'string')
    return null;
  return {
    year: body.year,
    imfEdition: typeof body.imfEdition === 'string' ? body.imfEdition : 'World Economic Outlook',
    countries: body.countries.flatMap((entry): WorldCountry[] =>
      isObject(entry) && typeof entry.iso3 === 'string' && typeof entry.name === 'string'
        ? [
            {
              iso3: entry.iso3,
              name: entry.name,
              growth: num(entry.growth),
              inflation: num(entry.inflation),
              debt: num(entry.debt),
              gdpUsd: num(entry.gdpUsd),
              gdpYear: typeof entry.gdpYear === 'string' ? entry.gdpYear : null,
            },
          ]
        : [],
    ),
  };
}

/** The largest economies by GDP in US dollars, largest first. */
export function largestEconomies(
  countries: readonly WorldCountry[],
  count = WORLD_TABLE,
): WorldCountry[] {
  return countries
    .filter((country) => country.gdpUsd !== null)
    .sort((a, b) => (b.gdpUsd ?? 0) - (a.gdpUsd ?? 0))
    .slice(0, count);
}

/**
 * Five shading steps for the map: the values' quintile edges, so each step holds about a fifth of
 * the countries with data. `stepOf` gives 0–4, or null without a value.
 */
export function quintiles(values: readonly number[]): {
  edges: number[];
  stepOf: (value: number | null) => number | null;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  const edges = [0.2, 0.4, 0.6, 0.8].map(at);
  return {
    edges,
    stepOf: (value) => {
      if (value === null || sorted.length === 0) return null;
      const step = edges.findIndex((edge) => value < edge);
      return step === -1 ? 4 : step;
    },
  };
}

/** The Global macro panel's figures, through the edge (its day-long cache answers repeats). */
export async function fetchWorld(): Promise<WorldData> {
  const data = parseWorld(await edgeJson('/world'));
  if (!data) throw new Error('unreadable IMF and World Bank answer');
  return data;
}

export interface WorldState {
  state: 'loading' | 'ready' | 'error';
  data: WorldData | null;
  failure: Failure | undefined;
}

/** IMF WEO and World Bank figures for every economy, refreshed every six hours. */
export function useWorld(): WorldState {
  const [world, setWorld] = useState<WorldState>({
    state: 'loading',
    data: null,
    failure: undefined,
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchWorld();
        if (cancelled) return;
        reportRestFreshness('imf', { kind: 'eod', cadence: 'annual' });
        reportRestFreshness('worldbank', { kind: 'eod', cadence: 'annual' });
        setWorld({ state: 'ready', data, failure: undefined });
      } catch (error) {
        if (cancelled) return;
        const failure = failureOf(error);
        reportRestFreshness('imf', freshnessOfFailure(failure));
        reportRestFreshness('worldbank', freshnessOfFailure(failure));
        setWorld((current) => ({
          state: current.data ? 'ready' : 'error',
          data: current.data,
          failure,
        }));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), WORLD_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return world;
}
