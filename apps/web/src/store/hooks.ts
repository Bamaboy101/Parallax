import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { SourceStatus } from '../feeds/protocol';
import type { AssetKind, Bar, Channel, SymbolRef } from '../feeds/types';
import { subscribeFeed } from './feedClient';
import { useHistory } from './history';
import {
  depthSamples,
  recentValues,
  setCursor,
  trackDepth,
  useTickStore,
  valueAt,
  type DepthSample,
  type TickOf,
  type TickState,
} from './ticks';

/** Keep a hub subscription open while the calling component is mounted. */
function useFeedSubscription(symbol: SymbolRef, channel: Channel, background = false): void {
  const { id, kind, base, quote } = symbol;
  useEffect(
    () => subscribeFeed({ id, kind, base, quote }, channel, background),
    [id, kind, base, quote, channel, background],
  );
}

/** The channel that carries a symbol's price: the bid/ask quote for FX, trades otherwise. */
export const priceChannel = (symbol: SymbolRef): 'quote' | 'trade' =>
  symbol.kind === 'fx' ? 'quote' : 'trade';

/** Keep the price channel of every listed symbol streaming while mounted. */
export function usePriceSubscriptions(symbols: readonly SymbolRef[]): void {
  const key = symbols
    .map(({ id, kind, base, quote }) => [id, kind, base, quote].join('|'))
    .join(',');
  useEffect(() => {
    const releases = key
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [id = '', kind = 'crypto', base = '', quote = ''] = entry.split('|');
        const symbol: SymbolRef = { id, kind: kind as AssetKind, base, quote };
        return subscribeFeed(symbol, priceChannel(symbol));
      });
    return () => {
      for (const release of releases) release();
    };
  }, [key]);
}

/**
 * The value of one symbol's channel, at the Rewind cursor or live. Re-renders only when that
 * value changes, so a ticking cell never re-renders its neighbours. `background`: the caller is
 * off screen, so a capped stream may serve it by polling instead.
 */
export function useTick<C extends Channel>(
  symbol: SymbolRef,
  channel: C,
  background = false,
): TickOf[C] | undefined {
  useFeedSubscription(symbol, channel, background);
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

/**
 * The most recent liquidations across several perps, newest first, at the Rewind cursor or live.
 * Each symbol's `liquidation` channel stays subscribed while mounted.
 */
export function useLiquidations(
  symbols: readonly SymbolRef[],
  limit: number,
): TickOf['liquidation'][] {
  const key = symbols
    .map(({ id, kind, base, quote }) => [id, kind, base, quote].join('|'))
    .join(',');
  useEffect(() => {
    const releases = key
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [id = '', kind = 'perp', base = '', quote = ''] = entry.split('|');
        return subscribeFeed({ id, kind: kind as AssetKind, base, quote }, 'liquidation');
      });
    return () => {
      for (const release of releases) release();
    };
  }, [key]);
  const versionStore = useMemo(() => {
    const ids = key.split(',').map((entry) => entry.split('|')[0] ?? '');
    return throttledValue(
      (state) => ids.map((id) => state.versions.liquidation[id] ?? 0).join(','),
      LIST_REFRESH_MS,
    );
  }, [key]);
  const version = useSyncExternalStore(versionStore.subscribe, versionStore.get);
  const cursor = useTickStore((state) => state.cursor);
  return useMemo(
    () =>
      key
        .split(',')
        .flatMap((entry) => recentValues('liquidation', entry.split('|')[0] ?? '', limit, cursor))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit),
    // `version` invalidates the memo when new liquidations arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, limit, cursor, version],
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

/** The heatmap redraws from the depth history at most this often. */
export const DEPTH_REFRESH_MS = 1000;

/**
 * F2: one symbol's whole-book depth samples, oldest first, up to the Rewind cursor, refreshed
 * once a second. While `enabled`, the book stays subscribed and sampled, so the history grows
 * from the moment it is switched on.
 */
export function useDepthHistory(symbol: SymbolRef, enabled: boolean): readonly DepthSample[] {
  const { id, kind, base, quote } = symbol;
  useEffect(() => {
    if (!enabled) return;
    const stopTracking = trackDepth(id);
    const unsubscribe = subscribeFeed({ id, kind, base, quote }, 'book');
    return () => {
      unsubscribe();
      stopTracking();
    };
  }, [enabled, id, kind, base, quote]);
  const versionStore = useMemo(
    () => throttledValue((state) => state.versions.book[id] ?? 0, DEPTH_REFRESH_MS),
    [id],
  );
  const version = useSyncExternalStore(versionStore.subscribe, versionStore.get);
  const cursor = useTickStore((state) => state.cursor);
  return useMemo(
    () => (enabled ? depthSamples(id, cursor) : []),
    // `version` invalidates the memo when new samples arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, id, cursor, version],
  );
}

/** One feed's connection status, for truth badges. */
export function useSourceStatus(source: string | undefined): SourceStatus | undefined {
  return useTickStore((state) => (source === undefined ? undefined : state.status[source]));
}

/**
 * The feed the hub has assigned to a symbol right now, or undefined while it waits. A quiet
 * symbol's last tick may be from a feed it has since moved off; this is where it is now.
 */
export function useServingSource(symbolId: string): string | undefined {
  return useTickStore(
    (state) =>
      Object.values(state.status).find((status) => status.serving.includes(symbolId))?.source,
  );
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

/** The price a price-channel tick stands for: a trade's price, or a quote's mid. */
export function lastPriceOf(tick: TickOf['trade'] | TickOf['quote']): LastPrice {
  const { source, receivedAt } = tick;
  if (tick.channel === 'quote') return { price: (tick.bid + tick.ask) / 2, source, receivedAt };
  return { price: tick.price, source, receivedAt };
}

/**
 * The price to show for a symbol: the last trade for crypto, the mid of the best bid and ask for
 * FX (Kraken's FX pairs quote far more often than they trade).
 */
export function useLastPrice(symbol: SymbolRef, background = false): LastPrice | undefined {
  const tick = useTick(symbol, priceChannel(symbol), background);
  return tick ? lastPriceOf(tick) : undefined;
}

const DAY_MS = 24 * 3_600_000;
/** Hourly history behind price lines is refreshed this often. */
export const PRICE_HISTORY_REFRESH_MS = 15 * 60_000;
/** Long enough to reach the previous session across a weekend or a holiday. */
const SESSIONS_MS = 5 * DAY_MS;

/** How much hourly history a price line needs: a day, or for US stocks the last sessions. */
export const priceHistorySpan = (symbol: SymbolRef): number =>
  symbol.kind === 'equity' ? SESSIONS_MS : DAY_MS;

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

/** Price, change and sparkline closes from the last price and the symbol's hourly history. */
export function priceLine(
  symbol: SymbolRef,
  last: LastPrice | undefined,
  bars: readonly Bar[],
): PriceLine {
  const price = last?.price ?? bars.at(-1)?.close;
  let base = bars[0]?.open;
  let closes = bars.map((bar) => bar.close);
  if (symbol.kind === 'equity') {
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

/**
 * Price, change and hourly closes; history refreshes every 15 minutes. `background`: the caller
 * is off screen (see useTick).
 */
export function usePriceLine(symbol: SymbolRef, background = false): PriceLine {
  const last = useLastPrice(symbol, background);
  const history = useHistory(symbol, '1h', priceHistorySpan(symbol), PRICE_HISTORY_REFRESH_MS);
  return priceLine(symbol, last, history?.bars ?? []);
}
