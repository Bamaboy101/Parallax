import { useEffect, useState } from 'react';
import { EdgeError, edgeJson } from './edge';

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
  error: string | undefined;
  /** The edge has no FRED key yet: a setup gap, not an outage. */
  unconfigured: boolean;
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

/** Year-on-year percent change of a monthly index (CPI): latest against the same month a year ago. */
export function yearOnYear(observations: readonly Observation[] | undefined): Stat | undefined {
  if (!observations) return undefined;
  /** YoY percent at a position from the end, against the same month a year earlier. */
  const at = (index: number) => {
    const reading = observations.at(index);
    if (!reading) return undefined;
    const yearAgo = `${String(Number(reading.date.slice(0, 4)) - 1)}${reading.date.slice(4)}`;
    const base = observations.find((observation) => observation.date === yearAgo);
    return base ? { date: reading.date, value: (reading.value / base.value - 1) * 100 } : undefined;
  };
  const now = at(-1);
  if (!now) return undefined;
  const prior = at(-2);
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

const LOADING: FredState = { state: 'loading', series: {}, error: undefined, unconfigured: false };

/** FRED series through the edge, refreshed hourly. `start` is 'YYYY-MM-DD'. */
export function useFred(series: readonly string[], start: string): FredState {
  const key = `${series.join(',')}|${start}`;
  const [fred, setFred] = useState<FredState & { key: string }>({ ...LOADING, key });

  useEffect(() => {
    let cancelled = false;
    const [ids = '', from = ''] = key.split('|');
    const load = async () => {
      try {
        const body = await edgeJson(`/fred?series=${ids}&start=${from}`);
        if (cancelled) return;
        if (!isSeriesMap(body)) throw new Error('unexpected FRED answer');
        setFred({
          key,
          state: 'ready',
          series: body.series,
          error: undefined,
          unconfigured: false,
        });
      } catch (error) {
        if (cancelled) return;
        setFred({
          key,
          state: 'error',
          series: {},
          error: error instanceof Error ? error.message : 'FRED unavailable',
          unconfigured: error instanceof EdgeError && error.status === 503,
        });
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
