import { useEffect, useState } from 'react';
import type { Freshness } from '../../design/format';
import { failureOf, RequestError, type Failure } from '../failure';
import { useKeyVault } from '../keys';
import { freshnessOfFailure, reportRestFreshness } from '../panels';
import { dataRequest, OPTIONS_FEED } from './client';
import { expiriesOf, parseChain, parseSpot, type OptionQuote } from './parse';

export const OPTIONS_SOURCE = 'alpaca-options';
/** The chain is re-read this often while a panel shows it. */
export const CHAIN_POLL_MS = 30_000;
/** Spot and the list of expiries change slowly. */
const EXPIRIES_REFRESH_MS = 30 * 60_000;
/** Expiries offered: the next ~3 months. */
const EXPIRY_HORIZON_DAYS = 92;
/** Strikes found for the expiry list: a narrow band around the spot keeps it to a page or two. */
const DISCOVERY_BAND = 0.02;
/** Strikes in the chain: ±20% of the spot. */
const CHAIN_BAND = 0.2;
/** Pages followed per request (1000 snapshots each). */
const MAX_PAGES = 3;

export interface OptionsState {
  state: 'no-key' | 'loading' | 'ready' | 'error';
  spot: { price: number; at: number } | null;
  expiries: string[];
  /** The expiry shown: the chosen one, else the soonest. */
  expiry: string | null;
  quotes: OptionQuote[];
  failure: Failure | undefined;
  updatedAt: number | null;
}

const EMPTY: OptionsState = {
  state: 'loading',
  spot: null,
  expiries: [],
  expiry: null,
  quotes: [],
  failure: undefined,
  updatedAt: null,
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const newYorkDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/**
 * The expiry a panel opens on: the soonest after today. Alpaca gives no implied volatility or
 * Greeks for contracts expiring today, so a same-day chain cannot show a smile; it stays one
 * pick away.
 */
export function defaultExpiry(expiries: readonly string[], now: number): string | null {
  const today = newYorkDay.format(now);
  return expiries.find((expiry) => expiry > today) ?? expiries[0] ?? null;
}

/** Every page of an underlying's chain for the given filters. */
async function chain(
  key: string,
  underlying: string,
  filters: Record<string, string>,
): Promise<OptionQuote[]> {
  const quotes: OptionQuote[] = [];
  let token: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await dataRequest(key, `/v1beta1/options/snapshots/${underlying}`, {
      feed: OPTIONS_FEED,
      limit: '1000',
      ...filters,
      ...(token ? { page_token: token } : {}),
    });
    const parsed = parseChain(body);
    quotes.push(...parsed.quotes);
    token = parsed.next;
    if (!token) break;
  }
  return quotes;
}

const keyFailure = (failure: Failure, error: unknown): Freshness =>
  error instanceof RequestError && (error.status === 401 || error.status === 403)
    ? { kind: 'key-rejected' }
    : freshnessOfFailure(failure);

/**
 * An underlying's option chain for one expiry (the soonest unless `chosen` names another),
 * with its spot price and the expiries on offer. Spot and expiries load on mount and every 30
 * minutes; the chain every 30 seconds. A failed refresh keeps what is shown.
 */
export function useOptions(underlying: string, chosen: string | null): OptionsState {
  const key = useKeyVault((vault) => vault.keys.alpaca);
  const [base, setBase] = useState<OptionsState & { for: string }>({ ...EMPTY, for: '' });
  const [chainState, setChain] = useState<{
    for: string;
    quotes: OptionQuote[];
    failure: Failure | undefined;
    updatedAt: number | null;
  }>({ for: '', quotes: [], failure: undefined, updatedAt: null });

  // Spot and expiries.
  useEffect(() => {
    if (!key) {
      reportRestFreshness(OPTIONS_SOURCE, { kind: 'no-key' });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const spot = parseSpot(
          await dataRequest(key, `/v2/stocks/${underlying}/snapshot`, { feed: 'iex' }),
        );
        if (!spot) throw new Error(`No recent trade for ${underlying}`);
        const now = Date.now();
        const nearby = await chain(key, underlying, {
          type: 'call',
          strike_price_gte: (spot.price * (1 - DISCOVERY_BAND)).toFixed(2),
          strike_price_lte: (spot.price * (1 + DISCOVERY_BAND)).toFixed(2),
          expiration_date_gte: day(now),
          expiration_date_lte: day(now + EXPIRY_HORIZON_DAYS * 86_400_000),
        });
        if (cancelled) return;
        const expiries = expiriesOf(nearby);
        setBase({
          ...EMPTY,
          for: underlying,
          state: 'ready',
          spot,
          expiries,
          expiry: defaultExpiry(expiries, now),
        });
      } catch (error) {
        if (cancelled) return;
        const failure = failureOf(error);
        reportRestFreshness(OPTIONS_SOURCE, keyFailure(failure, error));
        setBase((current) =>
          current.for === underlying && current.state === 'ready'
            ? { ...current, failure }
            : { ...EMPTY, for: underlying, state: 'error', failure },
        );
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), EXPIRIES_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [key, underlying]);

  const ready = base.for === underlying && base.state === 'ready';
  const expiry =
    ready && chosen !== null && base.expiries.includes(chosen)
      ? chosen
      : ready
        ? base.expiry
        : null;
  const spotPrice = ready ? (base.spot?.price ?? null) : null;

  // The chain for the expiry shown.
  useEffect(() => {
    if (!key || expiry === null || spotPrice === null) return;
    const target = `${underlying}|${expiry}`;
    let cancelled = false;
    const load = async () => {
      try {
        const quotes = await chain(key, underlying, {
          expiration_date: expiry,
          strike_price_gte: (spotPrice * (1 - CHAIN_BAND)).toFixed(2),
          strike_price_lte: (spotPrice * (1 + CHAIN_BAND)).toFixed(2),
        });
        if (cancelled) return;
        reportRestFreshness(OPTIONS_SOURCE, { kind: 'polled', everyMs: CHAIN_POLL_MS });
        setChain({ for: target, quotes, failure: undefined, updatedAt: Date.now() });
      } catch (error) {
        if (cancelled) return;
        const failure = failureOf(error);
        reportRestFreshness(OPTIONS_SOURCE, keyFailure(failure, error));
        setChain((current) =>
          current.for === target
            ? { ...current, failure }
            : { for: target, quotes: [], failure, updatedAt: null },
        );
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), CHAIN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [key, underlying, expiry, spotPrice]);

  if (!key) return { ...EMPTY, state: 'no-key' };
  if (base.for !== underlying) return EMPTY;
  const current = chainState.for === `${underlying}|${expiry ?? ''}`;
  return {
    state: base.state,
    spot: base.spot,
    expiries: base.expiries,
    expiry,
    quotes: current ? chainState.quotes : [],
    failure: base.failure ?? (current ? chainState.failure : undefined),
    updatedAt: current ? chainState.updatedAt : null,
  };
}
