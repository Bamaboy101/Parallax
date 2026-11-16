import { describe, expect, it } from 'vitest';
import { routeOrder } from './router';

describe('routeOrder', () => {
  it('never routes USD crypto to Binance, which only quotes USDT', () => {
    expect(routeOrder({ id: 'BTC-USD', kind: 'crypto', base: 'BTC', quote: 'USD' })).toEqual([
      'coinbase',
      'kraken',
    ]);
    expect(routeOrder({ id: 'BTC-USDT', kind: 'crypto', base: 'BTC', quote: 'USDT' })).toEqual([
      'binance',
      'kraken',
    ]);
  });

  it('routes FX to Kraken and US stocks to the Alpaca and Finnhub streams, then the poller', () => {
    expect(routeOrder({ id: 'EUR-USD', kind: 'fx', base: 'EUR', quote: 'USD' })).toEqual([
      'kraken',
    ]);
    expect(routeOrder({ id: 'AAPL', kind: 'equity', base: 'AAPL', quote: 'USD' })).toEqual([
      'alpaca',
      'finnhub',
      'alpaca-poll',
    ]);
  });
});
