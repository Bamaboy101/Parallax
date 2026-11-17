import { useEffect, useState } from 'react';
import { edgeJson } from './edge';
import { failureOf, type Failure } from './failure';

/** The edge caches FRED for an hour; FRED itself publishes daily at most. */
export const FRED_REFRESH_MS = 60 * 60_000;

export interface Observation {
  /** 'YYYY-MM-DD' */
  date: string;
  value: number;
}

export type SeriesMap = Readonly<Record<string, readonly Observation[]>>;

export interface FredState {
  state: 'loading' | 'ready' | 'error';
  series: SeriesMap;
  /** Why the last load failed; `unconfigured` means the edge has no FRED key yet. */
  failure: Failure | undefined;
}

/** Treasury constant-maturity yields for the curve, shortest first. */
export const CURVE: readonly (readonly [label: string, series: string])[] = [
  ['1M', 'DGS1MO'],
  ['3M', 'DGS3MO'],
  ['6M', 'DGS6MO'],
  ['1Y', 'DGS1'],
  ['2Y', 'DGS2'],
  ['5Y', 'DGS5'],
  ['10Y', 'DGS10'],
  ['30Y', 'DGS30'],
];

export const CURVE_IDS: readonly string[] = CURVE.map(([, id]) => id);
/** Fed funds, unemployment, CPI and payrolls: the Macro panel's indicator rows. */
export const STAT_IDS: readonly string[] = ['DFF', 'UNRATE', 'CPIAUCSL', 'PAYEMS'];
/** How far back each request reaches: a month's curve change; two years of CPI for year-on-year. */
export const CURVE_DAYS = 45;
export const STAT_DAYS = 800;

/** The last observation on or before `date`. Observations are oldest first. */
export function valueOn(
  observations: readonly Observation[],
  date: string,
): Observation | undefined {
  let found: Observation | undefined;
  for (const observation of observations) {
    if (observation.date > date) break;
    found = observation;
  }
  return found;
}

/** 'YYYY-MM-DD' a number of days before another. */
export function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export interface Stat {
  value: number;
  /** Change against the previous reading, when it means something. */
  change: number | undefined;
  asOf: string;
}

/** Latest reading and its change against the one before. */
export function latest(observations: readonly Observation[] | undefined): Stat | undefined {
  const last = observations?.at(-1);
  if (!last) return undefined;
  const previous = observations?.at(-2);
  return {
    value: last.value,
    change: previous ? last.value - previous.value : undefined,
    asOf: last.date,
  };
}

/**
 * Year-on-year percent change of a monthly index (CPI): the latest month that has a reading a
 * year earlier, against that reading. Releases can be missing (October 2025 CPI was never
 * published), so the newest month may have no base; `asOf` says which month is shown.
 */
export function yearOnYear(observations: readonly Observation[] | undefined): Stat | undefined {
  if (!observations) return undefined;
  const byDate = new Map(observations.map((observation) => [observation.date, observation.value]));
  const changes = observations.flatMap((reading) => {
    const base = byDate.get(
      `${String(Number(reading.date.slice(0, 4)) - 1)}${reading.date.slice(4)}`,
    );
    return base ? [{ date: reading.date, value: (reading.value / base - 1) * 100 }] : [];
  });
  const now = changes.at(-1);
  if (!now) return undefined;
  const prior = changes.at(-2);
  return { value: now.value, change: prior ? now.value - prior.value : undefined, asOf: now.date };
}

/** Month-on-month change of a level series (payrolls, thousands of jobs). */
export function monthlyChange(observations: readonly Observation[] | undefined): Stat | undefined {
  const stat = latest(observations);
  if (!stat || stat.change === undefined) return undefined;
  return { value: stat.change, change: undefined, asOf: stat.asOf };
}

function isSeriesMap(value: unknown): value is { series: SeriesMap } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'series' in value &&
    typeof value.series === 'object' &&
    value.series !== null
  );
}

/** FRED series through the edge (cached there for an hour). */
export async function fetchFred(series: readonly string[], start: string): Promise<SeriesMap> {
  const body = await edgeJson(`/fred?series=${series.join(',')}&start=${start}`);
  if (!isSeriesMap(body)) throw new Error('unexpected FRED answer');
  return body.series;
}

const LOADING: FredState = { state: 'loading', series: {}, failure: undefined };

/** FRED series through the edge, refreshed hourly. `start` is 'YYYY-MM-DD'. */
export function useFred(series: readonly string[], start: string): FredState {
  const key = `${series.join(',')}|${start}`;
  const [fred, setFred] = useState<FredState & { key: string }>({ ...LOADING, key });

  useEffect(() => {
    let cancelled = false;
    const [ids = '', from = ''] = key.split('|');
    const load = async () => {
      try {
        const series = await fetchFred(ids.split(','), from);
        if (cancelled) return;
        setFred({ key, state: 'ready', series, failure: undefined });
      } catch (error) {
        if (cancelled) return;
        const failure = failureOf(error);
        // A failed refresh keeps the series already shown.
        setFred((current) =>
          current.key === key && current.state === 'ready'
            ? { ...current, failure }
            : { key, state: 'error', series: {}, failure },
        );
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), FRED_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [key]);

  return fred.key === key ? fred : LOADING;
}
