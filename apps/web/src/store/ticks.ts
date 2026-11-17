import { create } from 'zustand';
import type { SourceStatus } from '../feeds/protocol';
import type {
  BarEvent,
  Channel,
  DerivEvent,
  FeedEvent,
  LiquidationEvent,
  QuoteEvent,
  TradeEvent,
} from '../feeds/types';
import { BOOK_KEEP, OrderBook, type BookView } from './orderBook';
import { RingBuffer } from './ringBuffer';

/** How far back Rewind can go. */
export const REWIND_MS = 60 * 60_000;

/** The store holds only what this page has seen: Rewind cannot reach before it opened. */
export const HISTORY_SINCE = Date.now();

/** What the store holds per channel: raw events, except the book, which is rebuilt. */
export interface TickOf {
  trade: TradeEvent;
  quote: QuoteEvent;
  bar: BarEvent;
  book: BookView;
  deriv: DerivEvent;
  liquidation: LiquidationEvent;
}

type PerChannel<T extends { [C in Channel]: unknown }> = { [C in Channel]: Record<string, T[C]> };

/**
 * History kept per symbol. Trades and liquidations are all kept; quotes, books and funding are
 * sampled (latest per bucket) so an hour of a busy symbol stays in a few MB.
 */
const RETENTION: { [C in Channel]: { capacity: number; bucketMs: number } } = {
  trade: { capacity: 100_000, bucketMs: 0 },
  quote: { capacity: 15_000, bucketMs: 250 },
  bar: { capacity: 120, bucketMs: 0 },
  book: { capacity: 3_700, bucketMs: 1000 },
  deriv: { capacity: 3_700, bucketMs: 1000 },
  liquidation: { capacity: 20_000, bucketMs: 0 },
};

export interface TickState {
  /** Newest value per channel and symbol id. */
  latest: PerChannel<TickOf>;
  /** Bumped per channel and symbol on every change, for widgets that read history. */
  versions: PerChannel<{ [C in Channel]: number }>;
  /** Feed status by source id. */
  status: Record<string, SourceStatus>;
  /** Rewind moment (local epoch ms), or null for live. */
  cursor: number | null;
}

const emptyChannels = <T extends { [C in Channel]: unknown }>(): PerChannel<T> => ({
  trade: {},
  quote: {},
  bar: {},
  book: {},
  deriv: {},
  liquidation: {},
});

export const useTickStore = create<TickState>()(() => ({
  latest: emptyChannels<TickOf>(),
  versions: emptyChannels<{ [C in Channel]: number }>(),
  status: {},
  cursor: null,
}));

const history: { [C in Channel]: Map<string, RingBuffer<TickOf[C]>> } = {
  trade: new Map(),
  quote: new Map(),
  bar: new Map(),
  book: new Map(),
  deriv: new Map(),
  liquidation: new Map(),
};
const books = new Map<string, OrderBook>();

function bufferFor<C extends Channel>(channel: C, symbol: string): RingBuffer<TickOf[C]> {
  const buffers = history[channel] as Map<string, RingBuffer<TickOf[C]>>;
  let buffer = buffers.get(symbol);
  if (!buffer) {
    buffer = new RingBuffer<TickOf[C]>(RETENTION[channel].capacity);
    buffers.set(symbol, buffer);
  }
  return buffer;
}

/** Append to history, keeping only the newest value per sampling bucket. */
function record<C extends Channel>(channel: C, symbol: string, value: TickOf[C]): void {
  const buffer = bufferFor(channel, symbol);
  const last = buffer.last();
  const { bucketMs } = RETENTION[channel];
  const sameBucket =
    last !== undefined &&
    (channel === 'bar'
      ? (last as BarEvent).ts === (value as BarEvent).ts
      : bucketMs > 0 &&
        Math.floor(last.receivedAt / bucketMs) === Math.floor(value.receivedAt / bucketMs));
  if (sameBucket) buffer.replaceLast(value);
  else buffer.push(value);
  buffer.evictBefore(value.receivedAt - REWIND_MS);
}

/**
 * F2: the whole book (up to BOOK_KEEP levels a side), bucketed into price bins once a second,
 * for the liquidity heatmap. Only symbols a chart is tracking are sampled.
 */
export interface DepthSample {
  receivedAt: number;
  /** Bin width in price units. */
  bin: number;
  /** [bin centre price, resting value (size × price)], bids and asks together. */
  levels: [number, number][];
}

const depthUsers = new Map<string, number>();
const depthHistory = new Map<string, RingBuffer<DepthSample>>();

/** A round bin about 5 basis points of the price: 1, 2 or 5 times a power of ten. */
export function depthBin(price: number): number {
  const target = price * 0.0005;
  const power = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((step) => step * power).find((step) => step >= target) ?? power * 10;
}

function sampleDepth(book: OrderBook, receivedAt: number): void {
  const buffer = depthHistory.get(book.symbol);
  if (!buffer) return;
  const last = buffer.last();
  if (last && Math.floor(last.receivedAt / 1000) === Math.floor(receivedAt / 1000)) return;
  const view = book.view(BOOK_KEEP);
  const bestBid = view?.bids[0]?.[0];
  const bestAsk = view?.asks[0]?.[0];
  if (!view || bestBid === undefined || bestAsk === undefined) return;
  const bin = last?.bin ?? depthBin((bestBid + bestAsk) / 2);
  const bins = new Map<number, number>();
  for (const [price, size] of [...view.bids, ...view.asks]) {
    const index = Math.floor(price / bin);
    bins.set(index, (bins.get(index) ?? 0) + size * price);
  }
  buffer.push({
    receivedAt,
    bin,
    levels: [...bins].map(([index, value]): [number, number] => [(index + 0.5) * bin, value]),
  });
  buffer.evictBefore(receivedAt - REWIND_MS);
}

/** Start sampling a symbol's whole book; the returned function stops when its last user does. */
export function trackDepth(symbol: string): () => void {
  depthUsers.set(symbol, (depthUsers.get(symbol) ?? 0) + 1);
  if (!depthHistory.has(symbol)) {
    depthHistory.set(symbol, new RingBuffer<DepthSample>(RETENTION.book.capacity));
  }
  return () => {
    const users = (depthUsers.get(symbol) ?? 1) - 1;
    if (users > 0) {
      depthUsers.set(symbol, users);
      return;
    }
    depthUsers.delete(symbol);
    depthHistory.delete(symbol);
  };
}

/** A tracked symbol's depth samples up to the cursor, oldest first. */
export function depthSamples(symbol: string, cursor: number | null): DepthSample[] {
  return (depthHistory.get(symbol)?.latest(RETENTION.book.capacity, cursor) ?? []).reverse();
}

/** Apply one batch from the hub. One store update per batch, so React renders once per frame. */
export function ingest(events: FeedEvent[]): void {
  if (events.length === 0) return;
  const latest = emptyChannels<TickOf>();
  const changedBooks = new Set<OrderBook>();

  for (const event of events) {
    switch (event.channel) {
      case 'trade':
        latest.trade[event.symbol] = event;
        record('trade', event.symbol, event);
        break;
      case 'quote':
        latest.quote[event.symbol] = event;
        record('quote', event.symbol, event);
        break;
      case 'deriv':
        latest.deriv[event.symbol] = event;
        record('deriv', event.symbol, event);
        break;
      case 'liquidation':
        latest.liquidation[event.symbol] = event;
        record('liquidation', event.symbol, event);
        break;
      case 'bar': {
        const current = useTickStore.getState().latest.bar[event.symbol];
        if (current && event.ts < current.ts) break; // late update for a closed bar
        latest.bar[event.symbol] = event;
        record('bar', event.symbol, event);
        break;
      }
      case 'book': {
        let book = books.get(event.symbol);
        if (!book) {
          book = new OrderBook(event.symbol);
          books.set(event.symbol, book);
        }
        if (book.apply(event)) changedBooks.add(book);
        break;
      }
    }
  }
  for (const book of changedBooks) {
    const view = book.view();
    if (!view) continue;
    latest.book[view.symbol] = view;
    record('book', view.symbol, view);
    sampleDepth(book, view.receivedAt);
  }

  useTickStore.setState((state) => {
    const versions = { ...state.versions };
    for (const channel of ['trade', 'quote', 'bar', 'book', 'deriv', 'liquidation'] as const) {
      const symbols = Object.keys(latest[channel]);
      if (symbols.length === 0) continue;
      versions[channel] = { ...versions[channel] };
      for (const symbol of symbols)
        versions[channel][symbol] = (versions[channel][symbol] ?? 0) + 1;
    }
    return {
      latest: {
        trade: { ...state.latest.trade, ...latest.trade },
        quote: { ...state.latest.quote, ...latest.quote },
        bar: { ...state.latest.bar, ...latest.bar },
        book: { ...state.latest.book, ...latest.book },
        deriv: { ...state.latest.deriv, ...latest.deriv },
        liquidation: { ...state.latest.liquidation, ...latest.liquidation },
      },
      versions,
    };
  });
}

export function setStatuses(sources: SourceStatus[]): void {
  useTickStore.setState({
    status: Object.fromEntries(sources.map((status) => [status.source, status])),
  });
}

/** Move the whole terminal to a moment in the last hour; null returns to live. */
export function setCursor(time: number | null): void {
  if (time === null) {
    useTickStore.setState({ cursor: null });
    return;
  }
  const now = Date.now();
  useTickStore.setState({ cursor: time >= now ? null : Math.max(now - REWIND_MS, time) });
}

/** The value of a channel at a moment (null = live). */
export function valueAt<C extends Channel>(
  state: TickState,
  channel: C,
  symbol: string,
): TickOf[C] | undefined {
  if (state.cursor === null) return state.latest[channel][symbol];
  return (history[channel] as Map<string, RingBuffer<TickOf[C]>>).get(symbol)?.at(state.cursor);
}

/** Up to `limit` recorded values at or before the cursor, newest first. */
export function recentValues<C extends Channel>(
  channel: C,
  symbol: string,
  limit: number,
  cursor: number | null,
): TickOf[C][] {
  return (
    (history[channel] as Map<string, RingBuffer<TickOf[C]>>).get(symbol)?.latest(limit, cursor) ??
    []
  );
}

/** The last recorded value at or before each moment (oldest first); undefined before the first. */
export function sampleAt<C extends Channel>(
  channel: C,
  symbol: string,
  times: readonly number[],
): (TickOf[C] | undefined)[] {
  const buffer = (history[channel] as Map<string, RingBuffer<TickOf[C]>>).get(symbol);
  return times.map((time) => buffer?.at(time));
}

/** Forget everything (tests, and a future "clear data" action). */
export function resetTicks(): void {
  for (const buffers of Object.values(history)) buffers.clear();
  books.clear();
  depthHistory.clear();
  depthUsers.clear();
  useTickStore.setState({
    latest: emptyChannels<TickOf>(),
    versions: emptyChannels<{ [C in Channel]: number }>(),
    status: {},
    cursor: null,
  });
}
