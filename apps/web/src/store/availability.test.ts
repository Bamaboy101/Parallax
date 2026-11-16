import { describe, expect, it } from 'vitest';
import type { SourceStatus } from '../feeds/protocol';
import type { SymbolRef } from '../feeds/types';
import { availabilityOf } from './availability';

const AAPL: SymbolRef = { id: 'AAPL', kind: 'equity', base: 'AAPL', quote: 'USD' };
const BTC: SymbolRef = { id: 'BTC-USD', kind: 'crypto', base: 'BTC', quote: 'USD' };

const status = (source: string, patch: Partial<SourceStatus> = {}): SourceStatus => ({
  source,
  state: 'idle',
  lastEventAt: null,
  latencyMs: null,
  stale: false,
  attempt: 0,
  retryAt: null,
  serving: [],
  symbolLimit: null,
  waiting: [],
  pollMs: null,
  key: null,
  rateLimited: false,
  ...patch,
});

const stocks = (patch: Partial<Record<string, Partial<SourceStatus>>> = {}) => ({
  alpaca: status('alpaca', { key: 'alpaca', symbolLimit: 30, ...patch.alpaca }),
  finnhub: status('finnhub', { key: 'finnhub', symbolLimit: 50, ...patch.finnhub }),
  'alpaca-poll': status('alpaca-poll', { key: 'alpaca', pollMs: 15_000, ...patch['alpaca-poll'] }),
});

describe('availabilityOf', () => {
  it('names every key that would unlock a stock, once each', () => {
    expect(availabilityOf(AAPL, stocks(), {})).toEqual({ kind: 'no-key', keys: 'alpaca,finnhub' });
    // The hub parks the subscription on Alpaca, which cannot run without its key.
    expect(
      availabilityOf(AAPL, stocks({ alpaca: { state: 'no-key', serving: ['AAPL'] } }), {}),
    ).toEqual({ kind: 'no-key', keys: 'alpaca,finnhub' });
  });

  it('is starting until the hub has reported, and connecting once a usable feed exists', () => {
    expect(availabilityOf(AAPL, {}, {})).toEqual({ kind: 'starting' });
    expect(availabilityOf(AAPL, stocks(), { alpaca: 'ID:SECRET' })).toEqual({
      kind: 'connecting',
      source: 'alpaca',
    });
  });

  it('reports the feed serving the symbol: live, rate limited or reconnecting', () => {
    const keys = { alpaca: 'ID:SECRET' };
    expect(
      availabilityOf(AAPL, stocks({ alpaca: { state: 'live', serving: ['AAPL'] } }), keys),
    ).toEqual({ kind: 'live', source: 'alpaca' });
    expect(
      availabilityOf(
        AAPL,
        stocks({
          'alpaca-poll': {
            state: 'reconnecting',
            serving: ['AAPL'],
            rateLimited: true,
            retryAt: 90_000,
          },
        }),
        keys,
      ),
    ).toEqual({ kind: 'rate-limited', source: 'alpaca-poll', retryAt: 90_000 });
    expect(
      availabilityOf(
        BTC,
        {
          coinbase: status('coinbase', { state: 'reconnecting', serving: ['BTC-USD'], retryAt: 5 }),
        },
        {},
      ),
    ).toEqual({ kind: 'offline', retryAt: 5 });
  });

  it('says a symbol waits on a full stream rather than calling it offline', () => {
    expect(
      availabilityOf(AAPL, stocks({ alpaca: { state: 'live', waiting: ['AAPL'] } }), {
        alpaca: 'ID:SECRET',
      }),
    ).toEqual({ kind: 'capped', source: 'alpaca', limit: 30 });
  });

  it('separates a rejected key from a missing one', () => {
    expect(
      availabilityOf(
        AAPL,
        stocks({ alpaca: { state: 'auth-failed' }, 'alpaca-poll': { state: 'auth-failed' } }),
        { alpaca: 'ID:WRONG' },
      ),
    ).toEqual({ kind: 'key-rejected', keys: 'alpaca' });
  });

  it('is offline, with the soonest retry, when every keyless feed is down', () => {
    expect(
      availabilityOf(
        BTC,
        {
          coinbase: status('coinbase', { state: 'down', retryAt: 60_000 }),
          kraken: status('kraken', { state: 'down', retryAt: 30_000 }),
        },
        {},
      ),
    ).toEqual({ kind: 'offline', retryAt: 30_000 });
  });
});
