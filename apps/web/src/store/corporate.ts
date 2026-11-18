import { useEffect, useState } from 'react';
import { isObject } from '../feeds/adapters/parse';
import { edgeJson } from './edge';
import { failureOf, RequestError, retryAtFrom, type Failure } from './failure';
import { useKeyVault } from './keys';
import { freshnessOfFailure, reportRestFreshness } from './panels';

/** The edge caches SEC answers 10 minutes; earnings dates move rarely. */
export const CORPORATE_REFRESH_MS = 30 * 60_000;
/** How far ahead the earnings calendar looks. */
export const EARNINGS_DAYS = 14;

const FINNHUB = 'https://finnhub.io/api/v1';
/** Badge source for the earnings calendar: Finnhub REST on the user's key, not its stream. */
export const EARNINGS_SOURCE = 'finnhub-earnings';

export interface Earnings {
  symbol: string;
  /** YYYY-MM-DD */
  date: string;
  /** Before the open, after the close, during market hours, or not said. */
  hour: 'bmo' | 'amc' | 'dmh' | '';
  quarter: number | null;
  year: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
}

export interface InsiderTrade {
  date: string;
  code: string;
  shares: number;
  price: number | null;
  acquired: boolean;
  after: number | null;
}

export interface InsiderFiling {
  filed: string;
  url: string;
  owner: string;
  role: string;
  plan: boolean;
  trades: InsiderTrade[];
}

export interface HolderFiling {
  form: string;
  filed: string;
  url: string;
  holder: string | null;
  percent: number | null;
}

export interface Ownership {
  ticker: string;
  name: string;
  insiders: InsiderFiling[];
  holders: HolderFiling[];
}

/** What SEC transaction codes mean, in Pro and in plain words (Simple). */
export const TRADE_CODES: Readonly<Record<string, { label: string; plain: string }>> = {
  P: { label: 'Buy', plain: 'Bought on the market' },
  S: { label: 'Sell', plain: 'Sold on the market' },
  A: { label: 'Grant', plain: 'Given shares as pay' },
  M: { label: 'Exercise', plain: 'Turned options into shares' },
  F: { label: 'Tax', plain: 'Shares kept back for tax' },
  G: { label: 'Gift', plain: 'Gave shares away' },
  C: { label: 'Convert', plain: 'Converted another security' },
  D: { label: 'To issuer', plain: 'Handed shares back to the company' },
  J: { label: 'Other', plain: 'Other' },
};

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Finnhub's `/calendar/earnings` answer → entries, soonest first; null when it is not one. */
export function parseEarnings(body: unknown): Earnings[] | null {
  if (!isObject(body) || !Array.isArray(body.earningsCalendar)) return null;
  return body.earningsCalendar
    .flatMap((entry): Earnings[] => {
      if (!isObject(entry) || typeof entry.symbol !== 'string' || typeof entry.date !== 'string')
        return [];
      const hour =
        entry.hour === 'bmo' || entry.hour === 'amc' || entry.hour === 'dmh' ? entry.hour : '';
      return [
        {
          symbol: entry.symbol,
          date: entry.date,
          hour,
          quarter: num(entry.quarter),
          year: num(entry.year),
          epsEstimate: num(entry.epsEstimate),
          epsActual: num(entry.epsActual),
          revenueEstimate: num(entry.revenueEstimate),
          revenueActual: num(entry.revenueActual),
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
}

/** The edge's `/insiders` answer; null when it is not one. */
export function parseOwnership(body: unknown): Ownership | null {
  if (!isObject(body) || !Array.isArray(body.insiders) || !Array.isArray(body.holders)) return null;
  const insiders = body.insiders.flatMap((filing): InsiderFiling[] =>
    isObject(filing) && Array.isArray(filing.trades)
      ? [
          {
            filed: text(filing.filed),
            url: text(filing.url),
            owner: text(filing.owner),
            role: text(filing.role),
            plan: filing.plan === true,
            trades: filing.trades.flatMap((trade): InsiderTrade[] =>
              isObject(trade) && typeof trade.shares === 'number'
                ? [
                    {
                      date: text(trade.date),
                      code: text(trade.code),
                      shares: trade.shares,
                      price: num(trade.price),
                      acquired: trade.acquired === true,
                      after: num(trade.after),
                    },
                  ]
                : [],
            ),
          },
        ]
      : [],
  );
  const holders = body.holders.flatMap((filing): HolderFiling[] =>
    isObject(filing) && typeof filing.form === 'string'
      ? [
          {
            form: filing.form,
            filed: text(filing.filed),
            url: text(filing.url),
            holder: typeof filing.holder === 'string' ? filing.holder : null,
            percent: num(filing.percent),
          },
        ]
      : [],
  );
  return { ticker: text(body.ticker), name: text(body.name), insiders, holders };
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** How many companies the market-wide list keeps. */
export const MARKET_EARNINGS = 25;

/**
 * The market-wide list: Finnhub's calendar has a few hundred companies a fortnight and no size,
 * so it keeps the ones analysts expect to have the largest revenue, soonest first.
 */
export function largestReporting(
  entries: readonly Earnings[],
  count = MARKET_EARNINGS,
): Earnings[] {
  return entries
    .filter((entry) => entry.revenueEstimate !== null)
    .sort((a, b) => (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0))
    .slice(0, count)
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
}

/**
 * Earnings dates from Finnhub on the user's own key, browser to Finnhub only. Without `symbol`,
 * the US calendar for the next two weeks, kept to its largest companies.
 */
export async function fetchEarnings(
  token: string,
  symbol: string | null,
  now = Date.now(),
): Promise<Earnings[]> {
  const params = new URLSearchParams({
    from: isoDay(now),
    to: isoDay(now + EARNINGS_DAYS * 86_400_000),
  });
  if (symbol) params.set('symbol', symbol);
  // Finnhub's CORS preflight does not allow its token header, so the token rides in the URL.
  params.set('token', token);
  const response = await fetch(`${FINNHUB}/calendar/earnings?${params.toString()}`);
  if (!response.ok) {
    throw new RequestError(
      `Finnhub: HTTP ${String(response.status)}`,
      response.status,
      response.status === 429 ? retryAtFrom(response.headers.get('Retry-After')) : null,
    );
  }
  const entries = parseEarnings(await response.json());
  if (!entries) throw new Error('unreadable Finnhub earnings calendar');
  return symbol ? entries : largestReporting(entries);
}

/** Insider trades and large holders for one US ticker, from SEC EDGAR through the edge. */
export async function fetchOwnership(ticker: string): Promise<Ownership> {
  const ownership = parseOwnership(
    await edgeJson(`/insiders?ticker=${encodeURIComponent(ticker)}`),
  );
  if (!ownership) throw new Error('unreadable SEC answer');
  return ownership;
}

/** Why the earnings list is empty: no key stored, the key was refused, or a request failure. */
export type EarningsProblem =
  { kind: 'no-key' } | { kind: 'key-rejected' } | { kind: 'failure'; failure: Failure };

export interface CorporateState {
  earnings: Earnings[] | null;
  earningsProblem: EarningsProblem | null;
  ownership: Ownership | null;
  ownershipFailure: Failure | null;
  loading: boolean;
}

/**
 * Corporate events for a ticker (earnings, insiders, large holders), or the market-wide earnings
 * list without one. Refreshed every 30 minutes.
 */
export function useCorporate(ticker: string | null): CorporateState {
  const token = useKeyVault((state) => state.keys.finnhub);
  const [state, setState] = useState<CorporateState & { key: string }>({
    key: '',
    earnings: null,
    earningsProblem: null,
    ownership: null,
    ownershipFailure: null,
    loading: true,
  });
  const key = `${ticker ?? ''}|${token ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const earningsLoad: Promise<Pick<CorporateState, 'earnings' | 'earningsProblem'>> = token
        ? fetchEarnings(token, ticker).then(
            (earnings) => {
              reportRestFreshness(EARNINGS_SOURCE, { kind: 'eod' });
              return { earnings, earningsProblem: null };
            },
            (error: unknown) => {
              if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
                reportRestFreshness(EARNINGS_SOURCE, { kind: 'key-rejected' });
                return { earnings: null, earningsProblem: { kind: 'key-rejected' } as const };
              }
              const failure = failureOf(error);
              reportRestFreshness(EARNINGS_SOURCE, freshnessOfFailure(failure));
              return { earnings: null, earningsProblem: { kind: 'failure', failure } as const };
            },
          )
        : Promise.resolve().then(() => {
            reportRestFreshness(EARNINGS_SOURCE, { kind: 'no-key' });
            return { earnings: null, earningsProblem: { kind: 'no-key' } as const };
          });
      const ownershipLoad: Promise<Pick<CorporateState, 'ownership' | 'ownershipFailure'>> = ticker
        ? fetchOwnership(ticker).then(
            (ownership) => {
              reportRestFreshness('sec', { kind: 'eod' });
              return { ownership, ownershipFailure: null };
            },
            (error: unknown) => {
              const failure = failureOf(error);
              reportRestFreshness('sec', freshnessOfFailure(failure));
              return { ownership: null, ownershipFailure: failure };
            },
          )
        : Promise.resolve({ ownership: null, ownershipFailure: null });
      const [earnings, ownership] = await Promise.all([earningsLoad, ownershipLoad]);
      if (cancelled) return;
      // A failed refresh keeps what is already shown.
      setState((current) => {
        const same = current.key === key;
        return {
          key,
          earnings: earnings.earnings ?? (same ? current.earnings : null),
          earningsProblem: earnings.earningsProblem,
          ownership: ownership.ownership ?? (same ? current.ownership : null),
          ownershipFailure: ownership.ownershipFailure,
          loading: false,
        };
      });
    };
    void load();
    const timer = window.setInterval(() => void load(), CORPORATE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [key, ticker, token]);

  return state.key === key
    ? state
    : {
        earnings: null,
        earningsProblem: null,
        ownership: null,
        ownershipFailure: null,
        loading: true,
      };
}
