import { describe, expect, it } from 'vitest';
import type { SymbolRef } from '../types';
import recording from './fixtures/kraken.jsonl?raw';
import { KrakenAdapter } from './kraken';
import { harness } from './testing';

const BTC_USD: SymbolRef = { id: 'BTC-USD', kind: 'crypto', base: 'BTC', quote: 'USD' };
const EUR_USD: SymbolRef = { id: 'EUR-USD', kind: 'fx', base: 'EUR', quote: 'USD' };

function connected() {
  const h = harness((ctx, createSocket) => new KrakenAdapter(ctx, createSocket));
  h.adapter.subscribe(BTC_USD, 'trade');
  h.adapter.subscribe(EUR_USD, 'trade');
  h.adapter.subscribe(BTC_USD, 'quote');
  h.adapter.subscribe(EUR_USD, 'quote');
  h.adapter.subscribe(BTC_USD, 'book');
  h.adapter.subscribe(BTC_USD, 'bar');
  void h.adapter.connect();
  h.socket().open();
  return h;
}

describe('KrakenAdapter', () => {
  it('serves USD and USDT crypto and the confirmed spot FX pairs', () => {
    const { adapter } = harness((ctx, createSocket) => new KrakenAdapter(ctx, createSocket));
    expect(adapter.supports(BTC_USD)).toBe(true);
    expect(adapter.supports({ ...BTC_USD, id: 'BTC-USDT', quote: 'USDT' })).toBe(true);
    expect(adapter.supports(EUR_USD)).toBe(true);
    expect(adapter.supports({ id: 'NZD-USD', kind: 'fx', base: 'NZD', quote: 'USD' })).toBe(false);
    expect(adapter.supports({ id: 'AAPL', kind: 'equity', base: 'AAPL', quote: 'USD' })).toBe(
      false,
    );
  });

  it('subscribes one frame per channel with its parameters', () => {
    const { socket } = connected();
    expect(socket().url).toBe('wss://ws.kraken.com/v2');
    expect(socket().sent).toEqual([
      { method: 'subscribe', params: { channel: 'trade', symbol: ['BTC/USD', 'EUR/USD'] } },
      {
        method: 'subscribe',
        params: { channel: 'ticker', symbol: ['BTC/USD', 'EUR/USD'], event_trigger: 'bbo' },
      },
      { method: 'subscribe', params: { channel: 'book', symbol: ['BTC/USD'], depth: 25 } },
      { method: 'subscribe', params: { channel: 'ohlc', symbol: ['BTC/USD'], interval: 1 } },
    ]);
  });

  it('normalises a recorded session', () => {
    const { socket, byChannel, logs } = connected();
    socket().replay(recording);
    expect(logs).toEqual([]);

    expect(byChannel('trade')).toEqual([
      expect.objectContaining({
        symbol: 'EUR-USD',
        source: 'kraken',
        price: 1.10081,
        size: 4.69,
        ts: Date.parse('2026-11-15T21:54:48.648532Z'),
      }),
    ]);

    const quotes = byChannel('quote');
    expect(quotes.find((quote) => quote.symbol === 'BTC-USD')).toMatchObject({
      bid: 65129.6,
      ask: 65129.7,
    });
    expect(quotes.find((quote) => quote.symbol === 'EUR-USD')).toMatchObject({
      bid: 1.10078,
      ask: 1.10081,
    });

    // The OHLC snapshot is history; only its last (live) bar is emitted.
    expect(byChannel('bar')[0]).toMatchObject({
      interval: '1m',
      ts: Date.parse('2026-11-15T21:54:00Z'),
      open: 65113.2,
      close: 65129.7,
    });
  });

  it('keeps the book at the subscribed depth by emitting drops as size 0', () => {
    const { socket, byChannel } = connected();
    socket().replay(recording);
    const books = byChannel('book');
    expect(books[0]?.kind).toBe('snapshot');
    expect(books.length).toBeGreaterThan(1);

    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    for (const book of books) {
      if (book.kind === 'snapshot') {
        bids.clear();
        asks.clear();
      }
      for (const [price, size] of book.bids) {
        if (size === 0) bids.delete(price);
        else bids.set(price, size);
      }
      for (const [price, size] of book.asks) {
        if (size === 0) asks.delete(price);
        else asks.set(price, size);
      }
      expect(bids.size).toBeLessThanOrEqual(25);
      expect(asks.size).toBeLessThanOrEqual(25);
    }
    expect(Math.max(...bids.keys())).toBeLessThan(Math.min(...asks.keys()));
  });
});
