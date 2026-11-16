import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { isObject } from '../../feeds/adapters/parse';
import { failureOf, RequestError, retryAtFrom, type Failure } from '../failure';
import { freshnessOfFailure, reportRestFreshness } from '../panels';
import { openOutcomes, type PredictionEvent } from './classify';
import type { PredictionsReply } from './protocol';

export const POLYMARKET_SOURCE = 'polymarket';
const CLOB = 'https://clob.polymarket.com';

/** Gamma's event lists are CDN-cached for 5 minutes; their volume and 24 h change move slowly. */
export const EVENTS_REFRESH_MS = 10 * 60_000;
/** Odds come from the order books' midpoints, which are not cached. */
export const ODDS_POLL_MS = 15_000;
/** Outcomes per event whose odds are polled: the ones a row and its detail show. */
const POLLED_OUTCOMES = 3;
/** Polymarket's batch midpoint limit. */
const MIDPOINT_BATCH = 500;

export interface PredictionsState {
  state: 'loading' | 'ready' | 'error';
  events: PredictionEvent[];
  /** Why the last event-list load failed; events already shown are kept. */
  failure: Failure | undefined;
  loadedAt: number | null;
  /** Latest midpoint per outcome token, 0 to 1. */
  midpoints: Readonly<Record<string, number>>;
  oddsAt: number | null;
}

const INITIAL: PredictionsState = {
  state: 'loading',
  events: [],
  failure: undefined,
  loadedAt: null,
  midpoints: {},
  oddsAt: null,
};

/** One store for every panel and the co-pilot, so they read the same odds. */
export const usePredictionStore = create<PredictionsState>()(() => INITIAL);

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new RequestError(
      `Polymarket answered HTTP ${String(response.status)}`,
      response.status,
      response.status === 429 ? retryAtFrom(response.headers.get('Retry-After')) : null,
    );
  }
  return response.json() as Promise<unknown>;
}

/** `{ token: "0.085" }` → `{ token: 0.085 }`, skipping anything that is not a probability. */
export function parseMidpoints(body: unknown): Record<string, number> {
  if (!isObject(body)) throw new Error('unexpected midpoint answer');
  const result: Record<string, number> = {};
  for (const [token, value] of Object.entries(body)) {
    const price = typeof value === 'string' ? Number(value) : value;
    if (typeof price === 'number' && price >= 0 && price <= 1) result[token] = price;
  }
  return result;
}

async function pollOdds(): Promise<void> {
  const now = Date.now();
  const tokens = usePredictionStore.getState().events.flatMap((event) =>
    openOutcomes(event, now)
      .slice(0, POLLED_OUTCOMES)
      .map((outcome) => outcome.tokenId),
  );
  if (tokens.length === 0) return;
  try {
    const batches: string[][] = [];
    for (let start = 0; start < tokens.length; start += MIDPOINT_BATCH) {
      batches.push(tokens.slice(start, start + MIDPOINT_BATCH));
    }
    const answers = await Promise.all(
      batches.map((batch) =>
        postJson(
          `${CLOB}/midpoints`,
          batch.map((token) => ({ token_id: token })),
        ),
      ),
    );
    const midpoints = Object.assign({}, ...answers.map(parseMidpoints)) as Record<string, number>;
    usePredictionStore.setState({ midpoints, oddsAt: Date.now() });
    reportRestFreshness(POLYMARKET_SOURCE, { kind: 'polled', everyMs: ODDS_POLL_MS });
  } catch (error) {
    // Odds stay as last fetched; the badge says why they are not fresh.
    reportRestFreshness(POLYMARKET_SOURCE, freshnessOfFailure(failureOf(error)));
  }
}

function receive(reply: PredictionsReply): void {
  if (reply.type === 'events') {
    usePredictionStore.setState({
      state: 'ready',
      events: reply.events,
      failure: undefined,
      loadedAt: reply.loadedAt,
    });
    void pollOdds();
    return;
  }
  const error = reply.offline
    ? new TypeError(reply.message)
    : new RequestError(reply.message, reply.status, reply.retryAt);
  const failure = failureOf(error);
  reportRestFreshness(POLYMARKET_SOURCE, freshnessOfFailure(failure));
  usePredictionStore.setState((current) => ({
    // A failed refresh keeps the events already shown; the panel says why they are old.
    state: current.events.length > 0 ? 'ready' : 'error',
    failure,
  }));
}

let users = 0;
let worker: Worker | null = null;
let timers: number[] = [];

function start(): void {
  // Tests (jsdom) have no Worker: the store then shows whatever state they set.
  if (typeof Worker === 'undefined') return;
  const created = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'predictions',
  });
  created.onmessage = (event: MessageEvent<PredictionsReply>) => {
    receive(event.data);
  };
  worker = created;
  const refresh = () => {
    created.postMessage('refresh');
  };
  refresh();
  timers = [
    window.setInterval(refresh, EVENTS_REFRESH_MS),
    window.setInterval(() => void pollOdds(), ODDS_POLL_MS),
  ];
}

function stop(): void {
  for (const timer of timers) window.clearInterval(timer);
  timers = [];
  worker?.terminate();
  worker = null;
}

/** Keeps Polymarket loading while any panel shows it; the last one to unmount stops it. */
export function usePredictionsFeed(): void {
  useEffect(() => {
    users += 1;
    if (users === 1) start();
    return () => {
      users -= 1;
      if (users === 0) stop();
    };
  }, []);
}

export interface OddsPoint {
  /** Epoch ms. */
  t: number;
  /** 0 to 1. */
  p: number;
}

export interface OddsHistory {
  state: 'loading' | 'ready' | 'error';
  /** Points per outcome token, oldest first. */
  series: Readonly<Record<string, readonly OddsPoint[]>>;
  failure: Failure | undefined;
}

/** A week of hourly odds. Polymarket caches price history for 90 seconds. */
const HISTORY_INTERVAL = '1w';
const HISTORY_FIDELITY_MIN = 60;
const HISTORY_TTL_MS = 5 * 60_000;
const historyCache = new Map<string, { at: number; points: OddsPoint[] }>();

/** `{ history: [{ t: seconds, p }] }` → points in epoch ms, oldest first. */
export function parseHistory(body: unknown): OddsPoint[] {
  if (!isObject(body) || !Array.isArray(body.history)) throw new Error('unexpected history');
  return body.history
    .flatMap((point) =>
      isObject(point) && typeof point.t === 'number' && typeof point.p === 'number'
        ? [{ t: point.t * 1000, p: point.p }]
        : [],
    )
    .sort((a, b) => a.t - b.t);
}

async function historyOf(token: string): Promise<OddsPoint[]> {
  const cached = historyCache.get(token);
  if (cached && Date.now() - cached.at < HISTORY_TTL_MS) return cached.points;
  const response = await fetch(
    `${CLOB}/prices-history?market=${encodeURIComponent(token)}` +
      `&interval=${HISTORY_INTERVAL}&fidelity=${String(HISTORY_FIDELITY_MIN)}`,
  );
  if (!response.ok) {
    throw new RequestError(
      `Polymarket answered HTTP ${String(response.status)}`,
      response.status,
      response.status === 429 ? retryAtFrom(response.headers.get('Retry-After')) : null,
    );
  }
  const points = parseHistory(await response.json());
  historyCache.set(token, { at: Date.now(), points });
  return points;
}

/** A week of odds for the given outcome tokens, for an event's chart. */
export function useOddsHistory(tokens: readonly string[]): OddsHistory {
  const key = tokens.join(',');
  const [history, setHistory] = useState<OddsHistory & { key: string }>({
    key,
    state: 'loading',
    series: {},
    failure: undefined,
  });

  useEffect(() => {
    let cancelled = false;
    const ids = key === '' ? [] : key.split(',');
    Promise.all(ids.map(async (token) => [token, await historyOf(token)] as const)).then(
      (entries) => {
        if (!cancelled)
          setHistory({
            key,
            state: 'ready',
            series: Object.fromEntries(entries),
            failure: undefined,
          });
      },
      (error: unknown) => {
        if (!cancelled) setHistory({ key, state: 'error', series: {}, failure: failureOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  return history.key === key ? history : { state: 'loading', series: {}, failure: undefined };
}
