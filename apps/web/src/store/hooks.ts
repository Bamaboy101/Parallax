import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { SourceStatus } from '../feeds/protocol';
import type { Channel, SymbolRef } from '../feeds/types';
import { subscribeFeed } from './feedClient';
import { useHistory } from './history';
import {
  recentValues,
  setCursor,
  useTickStore,
  valueAt,
  type TickOf,
  type TickState,
} from './ticks';

/** Keep a hub subscription open while the calling component is mounted. */
function useFeedSubscription(symbol: SymbolRef, channel: Channel): void {
  const { id, kind, base, quote } = symbol;
  useEffect(
    () => subscribeFeed({ id, kind, base, quote }, channel),
    [id, kind, base, quote, channel],
  );
}

/**
 * The value of one symbol's channel, at the Rewind cursor or live. Re-renders only when that
 * value changes, so a ticking cell never re-renders its neighbours.
 */
export function useTick<C extends Channel>(symbol: SymbolRef, channel: C): TickOf[C] | undefined {
  useFeedSubscription(symbol, channel);
  return useTickStore((state) => valueAt(state, channel, symbol.id));
}

/** Lists (the tape) refresh at most this often; single cells still update every frame. */
export const LIST_REFRESH_MS = 100;

/**
 * A store value that notifies at most once per `ms`. Rendering an 80-row list every frame
 * starves the main thread; ten times a second reads as continuous.
 */
function throttledValue<T>(select: (state: TickState) => T, ms: number) {
  let value = select(useTickStore.getState());
  return {
    get: () => value,
    subscribe: (notify: () => void) => {
      let timer: number | undefined;
      let last = 0;
      const unsubscribe = useTickStore.subscribe((state) => {
        if (timer !== undefined || select(state) === value) return;
        timer = window.setTimeout(
          () => {
            timer = undefined;
            last = Date.now();
            value = select(useTickStore.getState());
            notify();
          },
          Math.max(0, last + ms - Date.now()),
        );
      });
      return () => {
        window.clearTimeout(timer);
        unsubscribe();
      };
    },
  };
}

/** The most recent trades, newest first, at the Rewind cursor or live. */
export function useTrades(symbol: SymbolRef, limit: number): TickOf['trade'][] {
  useFeedSubscription(symbol, 'trade');
  const { id } = symbol;
  const versionStore = useMemo(
    () => throttledValue((state) => state.versions.trade[id] ?? 0, LIST_REFRESH_MS),
    [id],
  );
  const version = useSyncExternalStore(versionStore.subscribe, versionStore.get);
  const cursor = useTickStore((state) => state.cursor);
  return useMemo(
    () => recentValues('trade', id, limit, cursor),
    // `version` invalidates the memo when new trades arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, limit, cursor, version],
  );
}

/** The top of one symbol's book at the Rewind cursor or live, refreshed ten times a second. */
export function useBook(symbol: SymbolRef): TickOf['book'] | undefined {
  useFeedSubscription(symbol, 'book');
  const { id } = symbol;
  const bookStore = useMemo(
    () => throttledValue((state) => valueAt(state, 'book', id), LIST_REFRESH_MS),
    [id],
  );
  return useSyncExternalStore(bookStore.subscribe, bookStore.get);
}

/** One feed's connection status, for truth badges. */
export function useSourceStatus(source: string | undefined): SourceStatus | undefined {
  return useTickStore((state) => (source === undefined ? undefined : state.status[source]));
}

/** The Rewind cursor (null = live) and its setter. */
export function useCursor(): [number | null, (time: number | null) => void] {
  return [useTickStore((state) => state.cursor), setCursor];
}

export interface LastPrice {
  price: number;
  source: string;
  receivedAt: number;
}

/**
 * The price to show for a symbol: the last trade for crypto, the mid of the best bid and ask for
 * FX (Kraken's FX pairs quote far more often than they trade).
 */
export function useLastPrice(symbol: SymbolRef): LastPrice | undefined {
  const tick = useTick(symbol, symbol.kind === 'fx' ? 'quote' : 'trade');
  if (!tick) return undefined;
  const { source, receivedAt } = tick;
  if (tick.channel === 'quote') return { price: (tick.bid + tick.ask) / 2, source, receivedAt };
  return { price: tick.price, source, receivedAt };
}

const DAY_MS = 24 * 3_600_000;
const DAY_REFRESH_MS = 15 * 60_000;
/** Long enough to reach the previous session across a weekend or a holiday. */
const SESSIONS_MS = 5 * DAY_MS;

const newYorkDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

export interface PriceLine {
  /** Live price, or the last hourly close until the first live tick arrives. */
  price: number | undefined;
  /** False while `price` comes from history (an illiquid symbol, or a closed market). */
  live: boolean;
  /** The feed behind the live price. */
  source: string | undefined;
  /**
   * Percent change: against the price 24 hours ago for crypto and FX, against the previous
   * session's last close for US stocks (whose markets close nights and weekends).
   */
  changePct: number | undefined;
  /** Hourly closes for sparklines: the last 24 hours, or the latest session for US stocks. */
  closes: number[];
}

/** Price, change and hourly closes; history refreshes every 15 minutes. */
export function usePriceLine(symbol: SymbolRef): PriceLine {
  const last = useLastPrice(symbol);
  const equity = symbol.kind === 'equity';
  const history = useHistory(symbol, '1h', equity ? SESSIONS_MS : DAY_MS, DAY_REFRESH_MS);
  const bars = history?.bars ?? [];
  const price = last?.price ?? bars.at(-1)?.close;
  let base = bars[0]?.open;
  let closes = bars.map((bar) => bar.close);
  if (equity) {
    // Split hourly bars by New York trading date: the latest date is the current session.
    const latest = bars.at(-1);
    const session = latest ? newYorkDate.format(latest.ts) : undefined;
    const today = bars.filter((bar) => newYorkDate.format(bar.ts) === session);
    base = [...bars].reverse().find((bar) => newYorkDate.format(bar.ts) !== session)?.close;
    closes = today.map((bar) => bar.close);
  }
  return {
    price,
    live: last !== undefined,
    source: last?.source,
    changePct: price !== undefined && base ? (price / base - 1) * 100 : undefined,
    closes,
  };
}
