import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedAuthError, type FeedEvent, type SymbolRef } from '../types';
import { ALPACA_POLL_MS, AlpacaPollAdapter } from './alpacaPoll';
import snapshots from './fixtures/alpaca-snapshots.json?raw';

// Recorded 16 Nov 2026 during the US session with a free Basic key: EWJ, DBA and an unknown ZZZZ
// (Alpaca leaves unknown tickers out of the answer).
const stock = (ticker: string): SymbolRef => ({
  id: ticker,
  kind: 'equity',
  base: ticker,
  quote: 'USD',
});

function poller(keys: Record<string, string> = { alpaca: 'PKTEST:s3cret' }) {
  const events: FeedEvent[] = [];
  const adapter = new AlpacaPollAdapter({
    emit: (event) => events.push(event),
    getKey: (provider) => keys[provider],
    log: () => undefined,
  });
  return { adapter, events };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AlpacaPollAdapter', () => {
  it('polls every subscribed ticker in one request and never repeats a print', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(snapshots)));
    vi.stubGlobal('fetch', fetchMock);
    const { adapter, events } = poller();
    adapter.subscribe(stock('EWJ'), 'trade');
    adapter.subscribe(stock('EWJ'), 'bar');
    adapter.subscribe(stock('DBA'), 'trade');
    adapter.subscribe(stock('ZZZZ'), 'trade');
    adapter.subscribe(stock('EWJ'), 'book'); // IEX has no book
    void adapter.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://data.alpaca.markets/v2/stocks/snapshots?symbols=EWJ%2CDBA%2CZZZZ&feed=iex',
    );
    expect(init.headers).toEqual({ 'APCA-API-KEY-ID': 'PKTEST', 'APCA-API-SECRET-KEY': 's3cret' });
    expect(events.find((e) => e.symbol === 'EWJ' && e.channel === 'trade')).toMatchObject({
      source: 'alpaca-poll',
      ts: Date.parse('2026-11-16T16:36:04.52551484Z'),
      price: 90.73,
      size: 100,
    });
    expect(events.find((e) => e.symbol === 'EWJ' && e.channel === 'bar')).toMatchObject({
      interval: '1m',
      ts: Date.parse('2026-11-16T16:35:00Z'),
      close: 90.725,
      volume: 109,
    });
    expect(events.filter((e) => e.channel === 'quote').map((e) => e.symbol)).toEqual([
      'EWJ',
      'DBA',
    ]);
    expect(events.some((e) => e.symbol === 'ZZZZ')).toBe(false);

    // The next poll returns the same prints: quotes again, but no repeated trade.
    const before = events.filter((e) => e.channel === 'trade').length;
    await vi.advanceTimersByTimeAsync(ALPACA_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.channel === 'trade')).toHaveLength(before);
    expect(events.filter((e) => e.channel === 'quote')).toHaveLength(4);
    adapter.dispose();
    // Let the shared 200-a-minute queue finish its gap while timers are still fake.
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('ends the connection with FeedAuthError when Alpaca refuses the key', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 401 }))),
    );
    const { adapter } = poller();
    adapter.subscribe(stock('EWJ'), 'trade');
    const done = adapter.connect();
    const settled = expect(done).rejects.toBeInstanceOf(FeedAuthError);
    await vi.advanceTimersByTimeAsync(1000);
    await settled;
  });
});
