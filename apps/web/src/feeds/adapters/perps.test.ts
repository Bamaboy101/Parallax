import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DerivEvent, FeedEvent, LiquidationEvent, SymbolRef } from '../types';
import { BinanceFuturesAdapter } from './binanceFutures';
import { BybitAdapter } from './bybit';
import binanceSession from './fixtures/binance-futures.jsonl?raw';
import bybitSession from './fixtures/bybit-linear.jsonl?raw';
import okxSession from './fixtures/okx-swap.jsonl?raw';
import { OkxAdapter } from './okx';
import { harness } from './testing';

// Recorded 16 Nov 2026 from the public sockets: Bybit tickers.BTCUSDT and allLiquidation.*,
// OKX funding-rate / mark-price for BTC-USDT-SWAP and liquidation-orders for all swaps, Binance
// /market btcusdt@markPrice@1s and !forceOrder@arr.
const perp = (base: string): SymbolRef => ({
  id: `${base}-USDT-PERP`,
  kind: 'perp',
  base,
  quote: 'USDT',
});
const BTC = perp('BTC');

const derivs = (events: FeedEvent[]) =>
  events.filter((e): e is DerivEvent => e.channel === 'deriv');
const liquidations = (events: FeedEvent[]) =>
  events.filter((e): e is LiquidationEvent => e.channel === 'liquidation');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('BybitAdapter', () => {
  it('serves USDT perps only, and subscribes tickers and liquidations in one request', () => {
    const h = harness((ctx, createSocket) => new BybitAdapter(ctx, createSocket));
    expect(h.adapter.supports(BTC)).toBe(true);
    expect(h.adapter.supports({ id: 'BTC-USDT', kind: 'crypto', base: 'BTC', quote: 'USDT' })).toBe(
      false,
    );
    h.adapter.subscribe(BTC, 'deriv');
    h.adapter.subscribe(BTC, 'liquidation');
    h.adapter.subscribe(BTC, 'trade'); // not served here
    void h.adapter.connect();
    h.socket().open();
    expect(h.socket().sent).toEqual([
      { op: 'subscribe', args: ['tickers.BTCUSDT', 'allLiquidation.BTCUSDT'] },
    ]);
  });

  it('merges ticker deltas into the snapshot and names the liquidated side', () => {
    const h = harness((ctx, createSocket) => new BybitAdapter(ctx, createSocket));
    h.adapter.subscribe(BTC, 'deriv');
    h.adapter.subscribe(BTC, 'liquidation');
    void h.adapter.connect();
    h.socket().open();
    h.socket().replay(bybitSession);

    const ticks = derivs(h.events);
    expect(ticks[0]).toMatchObject({
      symbol: 'BTC-USDT-PERP',
      source: 'bybit',
      markPrice: 64783.22,
      fundingRate: 0.00009786,
      nextFundingTime: 1794873600000,
      openInterest: 69990.727,
      openInterestUsd: 4534224665.2,
    });
    // A delta with only bid/ask changes emits nothing; one with funding keeps the rest.
    expect(ticks.length).toBeLessThan(12);
    expect(ticks.at(-1)?.markPrice).toBeGreaterThan(0);
    expect(liquidations(h.events)).toEqual([
      expect.objectContaining({
        symbol: 'BTC-USDT-PERP',
        side: 'short', // "Sell": a short was liquidated (its bankruptcy price is above the mark)
        price: 65001.8,
        size: 0.223,
        ts: 1794848211761,
      }),
    ]);
  });
});

describe('OkxAdapter', () => {
  it('pings in plain text, polls open interest and converts liquidations to coins', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('/instruments')
              ? {
                  code: '0',
                  data: [
                    {
                      instId: url.includes('ZEC') ? 'ZEC-USDT-SWAP' : 'BTC-USDT-SWAP',
                      ctVal: url.includes('ZEC') ? '0.01' : '0.01',
                    },
                  ],
                }
              : {
                  code: '0',
                  data: [
                    {
                      instId: 'BTC-USDT-SWAP',
                      oi: '3152320.5',
                      oiCcy: '31523.205',
                      oiUsd: '2036588182.23',
                      ts: '1794848066418',
                    },
                  ],
                },
          ),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const h = harness((ctx, createSocket) => new OkxAdapter(ctx, createSocket));
    h.adapter.subscribe(BTC, 'deriv');
    h.adapter.subscribe(perp('ZEC'), 'liquidation');
    void h.adapter.connect();
    h.socket().open();
    await vi.advanceTimersByTimeAsync(1000);

    expect(h.socket().url).toBe('wss://ws.okx.com:443/ws/v5/public');
    expect(h.socket().sent[0]).toEqual({
      op: 'subscribe',
      args: [
        { channel: 'funding-rate', instId: 'BTC-USDT-SWAP' },
        { channel: 'mark-price', instId: 'BTC-USDT-SWAP' },
        { channel: 'liquidation-orders', instType: 'SWAP' },
      ],
    });
    h.socket().replay(okxSession);
    h.socket().receive('pong');

    expect(derivs(h.events).at(-1)).toMatchObject({
      source: 'okx',
      markPrice: 64783.4,
      fundingRate: 0.0000607053691528, // the newer of the two recorded funding frames
      nextFundingTime: 1794873600000,
      openInterest: 31523.205,
      openInterestUsd: 2036588182.23,
    });
    // The recording's ZEC liquidation: 76 contracts of 0.01 ZEC, a forced buy closing a short.
    expect(liquidations(h.events)).toEqual([
      expect.objectContaining({
        symbol: 'ZEC-USDT-PERP',
        side: 'short',
        price: 893.27,
        size: 0.76,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.socket().sent).toContain('ping');
    expect(h.logs.filter((line) => line.startsWith('warn'))).toEqual([]);
    h.adapter.dispose();
    await vi.advanceTimersByTimeAsync(1000);
  });
});

describe('BinanceFuturesAdapter', () => {
  it('values open interest at the mark price and keeps only wanted liquidations', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ symbol: 'BTCUSDT', openInterest: '93248.293', time: 1794848060367 }),
          ),
        ),
      ),
    );
    const h = harness((ctx, createSocket) => new BinanceFuturesAdapter(ctx, createSocket));
    h.adapter.subscribe(BTC, 'deriv');
    h.adapter.subscribe(perp('EVAA'), 'liquidation');
    void h.adapter.connect();
    h.socket().open();
    expect(h.socket().url).toBe('wss://fstream.binance.com/market/stream');
    expect(h.socket().sent[0]).toEqual({
      method: 'SUBSCRIBE',
      params: ['btcusdt@markPrice@1s', '!forceOrder@arr'],
      id: 1,
    });
    h.socket().replay(binanceSession);
    await vi.advanceTimersByTimeAsync(1000);

    const last = derivs(h.events).at(-1);
    expect(last).toMatchObject({ source: 'binance-futures', openInterest: 93248.293 });
    expect(last?.openInterestUsd).toBeCloseTo(93248.293 * (last?.markPrice ?? 0), 2);
    expect(derivs(h.events)[0]).toMatchObject({
      markPrice: 64792.8,
      fundingRate: 0.00007774,
      nextFundingTime: 1794873600000,
      openInterest: null,
    });
    // Only EVAA's liquidations: forced sells, so longs.
    const evaa = liquidations(h.events);
    expect(evaa.length).toBeGreaterThan(0);
    expect(evaa.every((e) => e.symbol === 'EVAA-USDT-PERP' && e.side === 'long')).toBe(true);
    // Average fill price and filled size of the first recorded EVAA force order.
    expect(evaa[0]).toMatchObject({ price: 3.002015, size: 30 });
    h.adapter.dispose();
    await vi.advanceTimersByTimeAsync(1000);
  });
});
