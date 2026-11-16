import { create } from 'zustand';
import type { SourceStatus } from '../feeds/protocol';
import type { BarEvent, Channel, FeedEvent, QuoteEvent, TradeEvent } from '../feeds/types';
import { OrderBook, type BookView } from './orderBook';
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
}

type PerChannel<T extends { [C in Channel]: unknown }> = { [C in Channel]: Record<string, T[C]> };

/**
 * History kept per symbol. Trades are all kept; quotes and books are sampled (latest per bucket)
 * so an hour of a busy symbol stays in a few MB.
 */
const RETENTION: { [C in Channel]: { capacity: number; bucketMs: number } } = {
  trade: { capacity: 100_000, bucketMs: 0 },
  quote: { capacity: 15_000, bucketMs: 250 },
  bar: { capacity: 120, bucketMs: 0 },
  book: { capacity: 3_700, bucketMs: 1000 },
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

/** Apply one batch from the hub. One store update per batch, so React renders once per frame. */
export function ingest(events: FeedEvent[]): void {
  if (events.length === 0) return;
  const latest = emptyChannels<TickOf>();
  const touched = { trade: new Set<string>(), quote: new Set<string>(), bar: new Set<string>() };
  const changedBooks = new Set<OrderBook>();

  for (const event of events) {
    switch (event.channel) {
      case 'trade':
        latest.trade[event.symbol] = event;
        record('trade', event.symbol, event);
        touched.trade.add(event.symbol);
        break;
      case 'quote':
        latest.quote[event.symbol] = event;
        record('quote', event.symbol, event);
        touched.quote.add(event.symbol);
        break;
      case 'bar': {
        const current = useTickStore.getState().latest.bar[event.symbol];
        if (current && event.ts < current.ts) break; // late update for a closed bar
        latest.bar[event.symbol] = event;
        record('bar', event.symbol, event);
        touched.bar.add(event.symbol);
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
  }

  useTickStore.setState((state) => {
    const versions = { ...state.versions };
    for (const channel of ['trade', 'quote', 'bar', 'book'] as const) {
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
  useTickStore.setState({
    latest: emptyChannels<TickOf>(),
    versions: emptyChannels<{ [C in Channel]: number }>(),
    status: {},
    cursor: null,
  });
}
