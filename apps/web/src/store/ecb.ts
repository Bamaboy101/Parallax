import { useEffect, useState } from 'react';
import { isObject } from '../feeds/adapters/parse';
import { reportRestFreshness } from './panels';

/**
 * ECB euro reference rates through Frankfurter (keyless, CORS open). v1 serves the ECB's own
 * set: about 30 currencies, published once per working day around 16:00 CET.
 */
const FRANKFURTER = 'https://api.frankfurter.dev/v1';
/** The rates change once a day; an hourly look is plenty. */
export const ECB_REFRESH_MS = 60 * 60_000;
/** Long enough to span a long weekend and still find the previous fixing. */
const LOOKBACK_DAYS = 10;

export interface EcbRate {
  /** ISO code, e.g. 'JPY'. */
  code: string;
  name: string;
  /** Units of the currency per US dollar. */
  perUsd: number;
  /** The currency's change against the dollar since the previous fixing, in percent. */
  changePct: number | undefined;
}

export interface EcbRates {
  /** Date of the latest fixing, YYYY-MM-DD. */
  date: string;
  rates: EcbRate[];
}

/**
 * A Frankfurter time series (base USD) and its currency names → the latest fixing with each
 * currency's change since the one before. A currency that strengthened (fewer units per dollar)
 * has a positive change.
 */
export function parseEcb(series: unknown, names: unknown): EcbRates | null {
  if (!isObject(series) || !isObject(series.rates)) return null;
  const dates = Object.keys(series.rates).sort();
  const latestDate = dates.at(-1);
  const latest = latestDate === undefined ? undefined : series.rates[latestDate];
  const previousDate = dates.at(-2);
  const previous = previousDate === undefined ? undefined : series.rates[previousDate];
  if (latestDate === undefined || !isObject(latest)) return null;
  const nameOf = (code: string) =>
    isObject(names) && typeof names[code] === 'string' ? names[code] : code;
  const rates = Object.entries(latest).flatMap(([code, value]) => {
    if (typeof value !== 'number' || value <= 0) return [];
    const before = isObject(previous) ? previous[code] : undefined;
    return [
      {
        code,
        name: nameOf(code),
        perUsd: value,
        changePct: typeof before === 'number' ? (before / value - 1) * 100 : undefined,
      },
    ];
  });
  return { date: latestDate, rates: rates.sort((a, b) => a.code.localeCompare(b.code)) };
}

export interface EcbState {
  state: 'loading' | 'ready' | 'error';
  data: EcbRates | null;
  error: string | undefined;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Frankfurter answered ${String(response.status)}`);
  return response.json() as Promise<unknown>;
}

/** The ECB's latest reference rates against the dollar, refreshed hourly. */
export function useEcbRates(): EcbState {
  const [ecb, setEcb] = useState<EcbState>({ state: 'loading', data: null, error: undefined });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const start = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
      try {
        const [series, names] = await Promise.all([
          getJson(`${FRANKFURTER}/${start}..?base=USD`),
          getJson(`${FRANKFURTER}/currencies`),
        ]);
        const data = parseEcb(series, names);
        if (!data) throw new Error('unreadable rates');
        if (cancelled) return;
        reportRestFreshness('ecb', { kind: 'eod' });
        setEcb({ state: 'ready', data, error: undefined });
      } catch (error) {
        if (cancelled) return;
        reportRestFreshness('ecb', { kind: 'offline' });
        setEcb((current) => ({
          // Keep the last good fixing on a failed refresh; the badge says it is offline.
          state: current.data ? 'ready' : 'error',
          data: current.data,
          error: error instanceof Error ? error.message : 'rates unavailable',
        }));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), ECB_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return ecb;
}
