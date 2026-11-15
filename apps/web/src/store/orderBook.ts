import type { BookEvent, Level } from '../feeds/types';

/** Levels kept per side. Far more than any view shows; bounds memory for full-book feeds. */
export const BOOK_KEEP = 1000;
/** Levels per side in a published view. */
export const BOOK_VIEW_DEPTH = 50;

/** What widgets read: the top of one symbol's book, best price first on each side. */
export interface BookView {
  symbol: string;
  source: string;
  /** Provider time of the last update applied. */
  ts: number;
  receivedAt: number;
  bids: Level[];
  asks: Level[];
}

const bestFirst = {
  bids: (a: number, b: number) => b - a,
  asks: (a: number, b: number) => a - b,
};

/** One symbol's book, rebuilt from snapshots and deltas. */
export class OrderBook {
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();
  private source: string | null = null;
  private ts = 0;
  private receivedAt = 0;

  constructor(readonly symbol: string) {}

  /** Apply one event. Returns false when it was ignored. */
  apply(event: BookEvent): boolean {
    if (event.kind === 'snapshot') {
      this.bids.clear();
      this.asks.clear();
      this.source = event.source;
    } else if (event.source !== this.source) {
      return false; // a delta must follow a snapshot from the same feed
    }
    for (const [price, size] of event.bids) {
      if (size === 0) this.bids.delete(price);
      else this.bids.set(price, size);
    }
    for (const [price, size] of event.asks) {
      if (size === 0) this.asks.delete(price);
      else this.asks.set(price, size);
    }
    this.ts = event.ts;
    this.receivedAt = event.receivedAt;
    return true;
  }

  /** Top of book, trimming each side to BOOK_KEEP as a side effect. */
  view(depth = BOOK_VIEW_DEPTH): BookView | undefined {
    if (this.source === null) return undefined;
    return {
      symbol: this.symbol,
      source: this.source,
      ts: this.ts,
      receivedAt: this.receivedAt,
      bids: top(this.bids, bestFirst.bids, depth),
      asks: top(this.asks, bestFirst.asks, depth),
    };
  }
}

function top(side: Map<number, number>, order: (a: number, b: number) => number, depth: number) {
  const prices = [...side.keys()].sort(order);
  for (const price of prices.slice(BOOK_KEEP)) side.delete(price);
  return prices.slice(0, depth).map((price): Level => [price, side.get(price) ?? 0]);
}
