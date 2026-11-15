import { describe, expect, it } from 'vitest';
import type { BookEvent, Level } from '../feeds/types';
import { BOOK_KEEP, OrderBook } from './orderBook';

const event = (
  kind: BookEvent['kind'],
  bids: Level[],
  asks: Level[],
  source = 'coinbase',
): BookEvent => ({
  channel: 'book',
  kind,
  bids,
  asks,
  symbol: 'BTC-USD',
  source,
  ts: 1,
  receivedAt: 2,
});

describe('OrderBook', () => {
  it('applies a snapshot then deltas, best price first, size 0 removing a level', () => {
    const book = new OrderBook('BTC-USD');
    book.apply(
      event(
        'snapshot',
        [
          [99, 1],
          [100, 2],
        ],
        [
          [101, 1],
          [102, 3],
        ],
      ),
    );
    book.apply(
      event(
        'delta',
        [
          [100, 0],
          [99.5, 4],
        ],
        [[101, 5]],
      ),
    );
    expect(book.view()).toMatchObject({
      source: 'coinbase',
      bids: [
        [99.5, 4],
        [99, 1],
      ],
      asks: [
        [101, 5],
        [102, 3],
      ],
    });
  });

  it('ignores deltas from a feed that did not send the snapshot', () => {
    const book = new OrderBook('BTC-USD');
    book.apply(event('snapshot', [[99, 1]], [[101, 1]]));
    expect(book.apply(event('delta', [[99, 0]], [], 'kraken'))).toBe(false);
    expect(book.view()?.bids).toEqual([[99, 1]]);
  });

  it('has no view before its first snapshot', () => {
    const book = new OrderBook('BTC-USD');
    expect(book.apply(event('delta', [[1, 1]], []))).toBe(false);
    expect(book.view()).toBeUndefined();
  });

  it('keeps at most BOOK_KEEP levels per side, dropping the worst', () => {
    const book = new OrderBook('BTC-USD');
    const bids = Array.from({ length: BOOK_KEEP + 10 }, (_, i): Level => [1000 - i, 1]);
    book.apply(event('snapshot', bids, []));
    book.view();
    // The worst bids are gone, so a later full view still starts from the best.
    book.apply(event('delta', [[1000 - BOOK_KEEP - 5, 0]], []));
    const view = book.view(BOOK_KEEP + 10);
    expect(view?.bids).toHaveLength(BOOK_KEEP);
    expect(view?.bids[0]).toEqual([1000, 1]);
    expect(view?.bids.at(-1)).toEqual([1000 - BOOK_KEEP + 1, 1]);
  });
});
