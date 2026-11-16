import { useEffect, useState } from 'react';
import { failureOf, RequestError, type Failure } from './failure';
import { freshnessOfFailure, reportRestFreshness } from './panels';

/**
 * TAIEX daily levels from the Taiwan Stock Exchange's open data (keyless, CORS open), licensed
 * under Taiwan's Open Government Data License v1.0, which requires the attribution below.
 */
const TWSE_CSV = 'https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=open_data';
export const TWSE_SOURCE = 'twse';
/** The close is published once a trading day; an hourly look is plenty. */
export const TAIEX_REFRESH_MS = 60 * 60_000;

/** The attribution the licence's Exhibit asks for, word for word with our year and dataset. */
export const TWSE_ATTRIBUTION =
  'Securities and Futures Bureau, Financial Supervisory Commission, R.O.C. (Taiwan Stock ' +
  'Exchange), 2026, Weighted Stock Price Index Historical Data. The Open Data is made available ' +
  'to the public under the Open Government Data License, version 1.0; User can make use of it ' +
  'when complying to the condition and obligation of its terms.';
export const OGDL_URL = 'https://data.gov.tw/license';

export interface IndexClose {
  /** Trading date, 'YYYY-MM-DD'. */
  date: string;
  close: number;
}

/** "1151102" (ROC year 115, i.e. 2026) → "2026-11-02". */
export function rocDate(value: string): string | null {
  const match = /^(\d{2,3})(\d{2})(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year = '', month = '', day = ''] = match;
  return `${String(Number(year) + 1911)}-${month}-${day}`;
}

/** TWSE's CSV (date, open, high, low, close) → closes, oldest first. */
export function parseTaiex(csv: string): IndexClose[] {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const cells = line.split(',').map((cell) => cell.replaceAll('"', '').trim());
      const date = rocDate(cells[0] ?? '');
      const close = Number((cells[4] ?? '').replaceAll(',', ''));
      return date !== null && Number.isFinite(close) && close > 0 ? [{ date, close }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface TaiexState {
  state: 'loading' | 'ready' | 'error';
  latest: IndexClose | undefined;
  /** Percent change from the previous trading day's close. */
  changePct: number | undefined;
  failure: Failure | undefined;
}

async function getCsv(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new RequestError(`TWSE answered HTTP ${String(response.status)}`, response.status);
  }
  return response.text();
}

/** 'YYYYMM01' for the month before `date` ('YYYY-MM-DD'). */
const previousMonth = (date: string): string => {
  const [year = 0, month = 1] = date.split('-').map(Number);
  const prior = new Date(Date.UTC(year, month - 2, 1));
  return `${String(prior.getUTCFullYear())}${String(prior.getUTCMonth() + 1).padStart(2, '0')}01`;
};

/** The latest TAIEX close and its change, refreshed hourly. */
export function useTaiex(): TaiexState {
  const [taiex, setTaiex] = useState<TaiexState>({
    state: 'loading',
    latest: undefined,
    changePct: undefined,
    failure: undefined,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        let closes = parseTaiex(await getCsv(TWSE_CSV));
        const latest = closes.at(-1);
        if (!latest) throw new Error('no TAIEX closes this month');
        // On a month's first trading day the previous close is in last month's file.
        if (closes.length < 2) {
          closes = [
            ...parseTaiex(await getCsv(`${TWSE_CSV}&date=${previousMonth(latest.date)}`)),
            ...closes,
          ];
        }
        const previous = closes.at(-2);
        if (cancelled) return;
        reportRestFreshness(TWSE_SOURCE, { kind: 'eod' });
        setTaiex({
          state: 'ready',
          latest,
          changePct: previous ? (latest.close / previous.close - 1) * 100 : undefined,
          failure: undefined,
        });
      } catch (error) {
        if (cancelled) return;
        const failure = failureOf(error);
        reportRestFreshness(TWSE_SOURCE, freshnessOfFailure(failure));
        // A failed refresh keeps the close already shown.
        setTaiex((current) => ({ ...current, state: current.latest ? 'ready' : 'error', failure }));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), TAIEX_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return taiex;
}
