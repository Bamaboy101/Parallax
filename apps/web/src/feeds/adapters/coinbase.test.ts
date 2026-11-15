import { describe, expect, it } from 'vitest';
import type { SymbolRef } from '../types';
import { CoinbaseAdapter } from './coinbase';
import recording from './fixtures/coinbase.jsonl?raw';
import { harness } from './testing';

const BTC_USD: SymbolRef = { id: 'BTC-USD', kind: 'crypto', base: 'BTC', quote: 'USD' };
const lines = recording.split('\n').filter((line) => line !== '');
const matches = lines.filter((line) => line.includes('"type":"match"'));

function connected() {
  const h = harness((ctx, createSocket) => new CoinbaseAdapter(ctx, createSocket));
  for (const channel of ['trade', 'quote', 'book', 'bar'] as const) {
    h.adapter.subscribe(BTC_USD, channel);
  }
  void h.adapter.connect();
  h.socket().open();
  return h;
}

describe('CoinbaseAdapter', () => {
  it('serves USD crypto pairs only', () => {
    const { adapter } = harness((ctx, createSocket) => new CoinbaseAdapter(ctx, createSocket));
    expect(adapter.supports(BTC_USD)).toBe(true);
    expect(adapter.supports({ ...BTC_USD, id: 'BTC-USDT', quote: 'USDT' })).toBe(false);
  });

  it('subscribes keyless channels, sharing matches between trades and bars', () => {
    const { socket } = connected();
    expect(socket().url).toBe('wss://ws-feed.exchange.coinbase.com');
    expect(socket().sent).toEqual([
      {
        type: 'subscribe',
        channels: [
          { name: 'matches', product_ids: ['BTC-USD'] },
          { name: 'ticker', product_ids: ['BTC-USD'] },
          { name: 'level2_batch', product_ids: ['BTC-USD'] },
        ],
      },
    ]);
  });

  it('normalises a recorded session', () => {
    const { socket, byChannel, logs } = connected();
    socket().replay(recording);
    expect(logs).toEqual([]);

    // last_match is history from before the subscription and is skipped.
    const trades = byChannel('trade');
    expect(trades).toHaveLength(matches.length);
    expect(trades[0]).toMatchObject({
      symbol: 'BTC-USD',
      source: 'coinbase',
      price: 65132.34,
      size: 0.00075645,
      ts: Date.parse('2026-11-15T21:54:47.001550Z'),
    });

    expect(byChannel('quote')[0]).toMatchObject({
      bid: 65132.34,
      ask: 65132.35,
      ts: Date.parse('2026-11-15T21:54:46.905671Z'),
    });

    const books = byChannel('book');
    expect(books[0]).toMatchObject({ kind: 'snapshot' });
    expect(books[0]?.bids).toHaveLength(30);
    expect(books.slice(1).every((book) => book.kind === 'delta')).toBe(true);
    expect(books.slice(1).every((book) => book.bids.length + book.asks.length > 0)).toBe(true);
  });

  it('builds 1-minute bars from matches', () => {
    const { socket, byChannel } = connected();
    socket().replay(recording);
    const bars = byChannel('bar');
    expect(bars).toHaveLength(matches.length);
    const last = bars.at(-1);
    const prices = byChannel('trade').map((trade) => trade.price);
    expect(last).toMatchObject({
      interval: '1m',
      ts: Date.parse('2026-11-15T21:54:00Z'),
      open: 65132.34,
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: 65132.35,
    });
    expect(last?.volume).toBeCloseTo(0.03422304, 8);
  });

  it('keeps matches flowing for bars when trades are unsubscribed', () => {
    const { adapter, socket, byChannel } = connected();
    adapter.unsubscribe(BTC_USD, 'trade');
    socket().replay(recording);
    expect(byChannel('trade')).toHaveLength(0);
    expect(byChannel('bar')).toHaveLength(matches.length);
  });
});
