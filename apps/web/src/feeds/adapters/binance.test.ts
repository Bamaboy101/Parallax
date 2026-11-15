import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SymbolRef } from '../types';
import { BinanceAdapter } from './binance';
import recording from './fixtures/binance.jsonl?raw';
import { harness } from './testing';

const BTC_USDT: SymbolRef = { id: 'BTC-USDT', kind: 'crypto', base: 'BTC', quote: 'USDT' };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function connected() {
  const h = harness((ctx, createSocket) => new BinanceAdapter(ctx, createSocket));
  for (const channel of ['trade', 'quote', 'book', 'bar'] as const) {
    h.adapter.subscribe(BTC_USDT, channel);
  }
  const done = h.adapter.connect();
  h.socket().open();
  return { ...h, done };
}

describe('BinanceAdapter', () => {
  it('serves USDT crypto pairs only', () => {
    const { adapter } = harness((ctx, createSocket) => new BinanceAdapter(ctx, createSocket));
    expect(adapter.supports(BTC_USDT)).toBe(true);
    expect(adapter.supports({ ...BTC_USDT, id: 'BTC-USD', quote: 'USD' })).toBe(false);
    expect(adapter.supports({ id: 'EUR-USD', kind: 'fx', base: 'EUR', quote: 'USD' })).toBe(false);
  });

  it('subscribes every stream in one SUBSCRIBE frame on open', () => {
    const { socket } = connected();
    expect(socket().url).toBe('wss://data-stream.binance.vision/stream');
    expect(socket().sent).toEqual([
      {
        method: 'SUBSCRIBE',
        params: [
          'btcusdt@trade',
          'btcusdt@bookTicker',
          'btcusdt@depth20@100ms',
          'btcusdt@kline_1m',
        ],
        id: 1,
      },
    ]);
  });

  it('normalises a recorded session', () => {
    const { socket, byChannel, logs } = connected();
    socket().replay(recording);

    expect(logs).toEqual([]);
    const trades = byChannel('trade');
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({
      symbol: 'BTC-USDT',
      source: 'binance',
      price: 65161.38,
      size: 0.00079,
      ts: 1794779677295,
    });

    const quotes = byChannel('quote');
    expect(quotes).toHaveLength(18);
    expect(quotes[0]).toMatchObject({
      bid: 65161.37,
      bidSize: 0.09506,
      ask: 65161.38,
      askSize: 4.04767,
    });

    const books = byChannel('book');
    expect(books).toHaveLength(19);
    for (const book of books) {
      expect(book.kind).toBe('snapshot');
      expect(book.bids).toHaveLength(20);
      expect(book.asks).toHaveLength(20);
      expect(book.bids[0]?.[0]).toBeLessThan(book.asks[0]?.[0] ?? 0);
    }

    expect(byChannel('bar')).toEqual([
      expect.objectContaining({
        interval: '1m',
        ts: 1794779640000,
        open: 65143.75,
        high: 65180.46,
        low: 65143.74,
        close: 65161.38,
        volume: 6.50281,
      }),
    ]);
  });

  it('unsubscribes after the control gap and drops late frames for that stream', () => {
    const { adapter, socket, byChannel } = connected();
    adapter.unsubscribe(BTC_USDT, 'trade');
    vi.advanceTimersByTime(250);
    expect(socket().sent.at(-1)).toEqual({
      method: 'UNSUBSCRIBE',
      params: ['btcusdt@trade'],
      id: 2,
    });

    socket().replay(recording);
    expect(byChannel('trade')).toHaveLength(0);
    expect(byChannel('quote').length).toBeGreaterThan(0);
  });

  it('ends the connection when the server announces a shutdown', async () => {
    const { socket, done } = connected();
    socket().receive(
      JSON.stringify({ stream: '!serverShutdown', data: { e: 'serverShutdown', E: 1, T: 2 } }),
    );
    await expect(done).resolves.toBeUndefined();
  });
});
