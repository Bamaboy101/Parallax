import { afterEach, describe, expect, it } from 'vitest';
import type { FeedEvent } from '../feeds/types';
import { instrument } from './symbols';
import { ingest, resetTicks } from './ticks';
import {
  MIN_TRADES_FOR_PERCENTILE,
  perpFor,
  radarAt,
  WHALE_FLOOR,
  WHALE_WINDOW_MS,
  whaleThreshold,
} from './whales';

const NOW = Date.UTC(2026, 10, 17, 21);

const trade = (symbol: string, ts: number, price: number, size: number): FeedEvent => ({
  channel: 'trade',
  symbol,
  source: 'coinbase',
  ts,
  receivedAt: ts,
  price,
  size,
});

afterEach(() => {
  resetTicks();
});

describe('whaleThreshold', () => {
  it('uses the floor while there are too few trades for a percentile', () => {
    expect(whaleThreshold([5_000_000])).toBe(WHALE_FLOOR);
  });

  it('raises the bar in a busy market and never drops it below the floor', () => {
    // 1,000 trades from $1k to $1M: the top 0.5% start at about $995k.
    const busy = Array.from({ length: 1_000 }, (_, index) => (index + 1) * 1_000);
    expect(whaleThreshold(busy)).toBe(996_000);
    const quiet = Array.from({ length: MIN_TRADES_FOR_PERCENTILE }, () => 50);
    expect(whaleThreshold(quiet)).toBe(WHALE_FLOOR);
  });
});

describe('radarAt', () => {
  it('counts whale prints in the window and the coin perp’s large liquidations', () => {
    const btc = instrument('BTC-USD');
    if (!btc) throw new Error('BTC-USD missing');
    const perp = perpFor(btc);
    expect(perp?.id).toBe('BTC-USDT-PERP');
    ingest([
      trade('BTC-USD', NOW - 60_000, 64_000, 0.01), // $640
      trade('BTC-USD', NOW - 30_000, 64_000, 2), // $128k: a whale
      trade('BTC-USD', NOW - WHALE_WINDOW_MS - 60_000, 64_000, 5), // a whale, but too old
      {
        channel: 'liquidation',
        symbol: 'BTC-USDT-PERP',
        source: 'bybit',
        ts: NOW - 10_000,
        receivedAt: NOW - 10_000,
        side: 'long',
        price: 64_000,
        size: 3, // $192k
      },
      {
        channel: 'liquidation',
        symbol: 'BTC-USDT-PERP',
        source: 'bybit',
        ts: NOW - 5_000,
        receivedAt: NOW - 5_000,
        side: 'short',
        price: 64_000,
        size: 0.5, // $32k: under the floor
      },
    ]);
    const radar = radarAt(btc, NOW, null);
    expect(radar.threshold).toBe(WHALE_FLOOR);
    expect(radar.trades.map((event) => event.size)).toEqual([2]);
    expect(radar.liquidations.map((event) => event.size)).toEqual([3]);
  });

  it('gives stocks no perp, so only their trades count', () => {
    const spy = instrument('SPY');
    if (!spy) throw new Error('SPY missing');
    expect(perpFor(spy)).toBeUndefined();
  });
});
