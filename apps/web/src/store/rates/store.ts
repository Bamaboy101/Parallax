import { useEffect } from 'react';
import { create } from 'zustand';
import { failureOf, RequestError, type Failure } from '../failure';
import { freshnessOfFailure, reportRestFreshness } from '../panels';
import {
  daysBefore,
  mergeCurves,
  parseRefRates,
  parseTreasuryCsv,
  type CurveDay,
  type RefRate,
} from './parse';

export const TREASURY_SOURCE = 'treasury';
export const NYFED_SOURCE = 'nyfed';
/** Both publish once a business day; an hourly look picks up a new day promptly. */
export const RATES_REFRESH_MS = 60 * 60_000;

const TREASURY = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates';
const NYFED = 'https://markets.newyorkfed.org/api/rates';

/** The Treasury's yearly CSV of daily par yield curve rates. */
export const treasuryUrl = (year: number): string =>
  `${TREASURY}/daily-treasury-rates.csv/${String(year)}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${String(year)}&page&_format=csv`;

/** A New York Fed reference rate between two dates. */
export const nyFedUrl = (path: 'secured/sofr' | 'unsecured/effr', from: string, to: string) =>
  `${NYFED}/${path}/search.json?startDate=${from}&endDate=${to}`;

export interface RatesState {
  state: 'loading' | 'ready' | 'error';
  /** Daily curves since the start of last year, oldest first. */
  curve: CurveDay[];
  sofr: RefRate[];
  effr: RefRate[];
  failure: Failure | undefined;
  loadedAt: number | null;
}

const INITIAL: RatesState = {
  state: 'loading',
  curve: [],
  sofr: [],
  effr: [],
  failure: undefined,
  loadedAt: null,
};

/** One store for the rates desk and the co-pilot. */
export const useRatesStore = create<RatesState>()(() => INITIAL);

async function get(url: string, as: 'text' | 'json'): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new RequestError(`HTTP ${String(response.status)}`, response.status);
  return as === 'text' ? response.text() : response.json();
}

/** Load the curve (this year and last) and a year of SOFR and EFFR; each source may fail alone. */
export async function loadRates(now = Date.now()): Promise<void> {
  const today = new Date(now).toISOString().slice(0, 10);
  const year = new Date(now).getUTCFullYear();
  const from = daysBefore(today, 400);
  const [thisYear, lastYear, sofr, effr] = await Promise.allSettled([
    get(treasuryUrl(year), 'text'),
    get(treasuryUrl(year - 1), 'text'),
    get(nyFedUrl('secured/sofr', from, today), 'json'),
    get(nyFedUrl('unsecured/effr', from, today), 'json'),
  ]);

  let curve: CurveDay[] | null = null;
  let treasuryFailure: Failure | undefined;
  if (thisYear.status === 'fulfilled') {
    const earlier = lastYear.status === 'fulfilled' ? parseTreasuryCsv(String(lastYear.value)) : [];
    curve = mergeCurves(earlier, parseTreasuryCsv(String(thisYear.value)));
  } else {
    treasuryFailure = failureOf(thisYear.reason);
  }

  let sofrRates: RefRate[] | null = null;
  let effrRates: RefRate[] | null = null;
  let nyFedFailure: Failure | undefined;
  if (sofr.status === 'fulfilled') sofrRates = parseRefRates(sofr.value);
  else nyFedFailure = failureOf(sofr.reason);
  if (effr.status === 'fulfilled') effrRates = parseRefRates(effr.value);
  else nyFedFailure = failureOf(effr.reason);

  reportRestFreshness(
    TREASURY_SOURCE,
    treasuryFailure ? freshnessOfFailure(treasuryFailure) : { kind: 'eod' },
  );
  reportRestFreshness(
    NYFED_SOURCE,
    nyFedFailure ? freshnessOfFailure(nyFedFailure) : { kind: 'eod' },
  );

  // A failed source keeps what is shown; the panel says why it may be old.
  useRatesStore.setState((current) => {
    const next = {
      curve: curve ?? current.curve,
      sofr: sofrRates ?? current.sofr,
      effr: effrRates ?? current.effr,
    };
    const hasData = next.curve.length > 0 || next.sofr.length > 0 || next.effr.length > 0;
    return {
      ...next,
      state: hasData ? 'ready' : 'error',
      failure: treasuryFailure ?? nyFedFailure,
      loadedAt: Date.now(),
    };
  });
}

let users = 0;
let timer: number | undefined;

/** Keeps the rates loaded while any panel shows them. */
export function useRatesFeed(): void {
  useEffect(() => {
    users += 1;
    if (users === 1) {
      void loadRates();
      timer = window.setInterval(() => void loadRates(), RATES_REFRESH_MS);
    }
    return () => {
      users -= 1;
      if (users === 0) window.clearInterval(timer);
    };
  }, []);
}
