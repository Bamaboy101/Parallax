import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedAuthError, type SymbolRef } from '../types';
import { AlpacaAdapter } from './alpaca';
import authFailed from './fixtures/alpaca-auth-failed.jsonl?raw';
import emptyBars from './fixtures/alpaca-bars-empty.json?raw';
import barsPage from './fixtures/alpaca-bars.json?raw';
import iexSession from './fixtures/alpaca-iex.jsonl?raw';
import testSession from './fixtures/alpaca-test.jsonl?raw';
import { harness } from './testing';

// Recorded 16 Nov 2026 with a free Basic key: the IEX stream with the market closed (handshake
// only), and the always-on test stream, whose FAKEPACA prints share the live message format.
const AAPL: SymbolRef = { id: 'AAPL', kind: 'equity', base: 'AAPL', quote: 'USD' };
const FAKEPACA: SymbolRef = { id: 'FAKEPACA', kind: 'equity', base: 'FAKEPACA', quote: 'USD' };
const KEYS = { alpaca: 'PKTEST:s3cret' };
const iexLines = iexSession.split('\n').filter((line) => line !== '');

function connected(symbol: SymbolRef) {
  const h = harness((ctx, createSocket) => new AlpacaAdapter(ctx, createSocket), KEYS);
  for (const channel of ['trade', 'quote', 'bar', 'book'] as const)
    h.adapter.subscribe(symbol, channel);
  const done = h.adapter.connect();
  h.socket().open();
  return { ...h, done };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AlpacaAdapter', () => {
  it('serves US stocks only', () => {
    const { adapter } = harness((ctx, createSocket) => new AlpacaAdapter(ctx, createSocket));
    expect(adapter.supports(AAPL)).toBe(true);
    expect(adapter.supports({ id: 'BTC-USD', kind: 'crypto', base: 'BTC', quote: 'USD' })).toBe(
      false,
    );
  });

  it('authenticates after the welcome, then subscribes once to what is wanted', () => {
    const { socket } = connected(AAPL);
    expect(socket().url).toBe('wss://stream.data.alpaca.markets/v2/iex');
    expect(socket().sent).toEqual([]);
    socket().receive(iexLines[0] ?? '');
    expect(socket().sent).toEqual([{ action: 'auth', key: 'PKTEST', secret: 's3cret' }]);
    socket().receive(iexLines[1] ?? '');
    // Trades feed both the tape and the live bar; IEX has no book.
    expect(socket().sent.at(-1)).toEqual({
      action: 'subscribe',
      trades: ['AAPL'],
      quotes: ['AAPL'],
    });
  });

  it('normalises a recorded session', () => {
    const { socket, byChannel, logs } = connected(FAKEPACA);
    socket().replay(testSession);
    expect(logs).toEqual([]);

    const trades = byChannel('trade');
    expect(trades).toHaveLength(3);
    expect(trades[0]).toMatchObject({
      symbol: 'FAKEPACA',
      source: 'alpaca',
      price: 134.56,
      size: 3,
      ts: Date.parse('2026-11-16T03:20:15.940Z'),
    });
    expect(byChannel('quote')).toHaveLength(3);
    expect(byChannel('quote')[0]).toMatchObject({
      bid: 133.85,
      bidSize: 4,
      ask: 135.77,
      askSize: 5,
    });
    // All three prints fall in one minute.
    expect(byChannel('bar').at(-1)).toMatchObject({
      ts: Date.parse('2026-11-16T03:20:00Z'),
      open: 134.56,
      close: 134.56,
      volume: 9,
      interval: '1m',
    });
  });

  it('ends the connection with FeedAuthError on the recorded auth failure', async () => {
    const { socket, done } = connected(AAPL);
    socket().replay(authFailed);
    await expect(done).rejects.toBeInstanceOf(FeedAuthError);
  });

  it('treats the connection limit as a retryable failure, not a bad key', async () => {
    const { socket, done } = connected(AAPL);
    // Message as documented for a second connection on the same key.
    socket().receive('[{"T":"error","code":406,"msg":"connection limit exceeded"}]');
    const error: unknown = await done.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(FeedAuthError);
  });

  it('unsubscribes a ticker only when no channel needs it', () => {
    vi.useFakeTimers();
    const { adapter, socket } = connected(AAPL);
    socket().receive(iexLines[0] ?? '');
    socket().receive(iexLines[1] ?? '');
    adapter.unsubscribe(AAPL, 'trade');
    adapter.unsubscribe(AAPL, 'quote');
    vi.runOnlyPendingTimers();
    // The live bar still needs trades.
    expect(socket().sent.at(-1)).toEqual({ action: 'unsubscribe', quotes: ['AAPL'] });
  });

  it('accepts a key on the test stream once a FAKEPACA message arrives', async () => {
    const { adapter, socket } = harness(
      (ctx, createSocket) => new AlpacaAdapter(ctx, createSocket),
      KEYS,
    );
    const check = adapter.verifyKey();
    expect(socket().url).toBe('wss://stream.data.alpaca.markets/v2/test');
    socket().open();
    socket().replay(testSession);
    await expect(check).resolves.toBeUndefined();
    expect(socket().sent).toEqual([
      { action: 'auth', key: 'PKTEST', secret: 's3cret' },
      { action: 'subscribe', trades: ['FAKEPACA'], quotes: ['FAKEPACA'] },
    ]);
    expect(socket().readyState).toBe(3);
  });

  it('rejects a refused key on the test stream', async () => {
    const { adapter, socket } = harness(
      (ctx, createSocket) => new AlpacaAdapter(ctx, createSocket),
      KEYS,
    );
    const check = adapter.verifyKey();
    socket().open();
    socket().replay(authFailed);
    await expect(check).rejects.toBeInstanceOf(FeedAuthError);
  });

  it('pages IEX history with the key in headers, never in the URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(barsPage))
      .mockResolvedValueOnce(new Response(emptyBars));
    vi.stubGlobal('fetch', fetchMock);
    const { adapter } = harness((ctx, createSocket) => new AlpacaAdapter(ctx, createSocket), KEYS);
    const from = Date.parse('2026-11-11T00:00:00Z');
    const to = Date.parse('2026-11-12T00:00:00Z');

    const bars = await adapter.fetchHistory(AAPL, '1h', from, to);

    expect(bars).toEqual([
      {
        ts: Date.parse('2026-11-11T13:00:00Z'),
        open: 346.7,
        high: 347.13,
        low: 346.7,
        close: 347.13,
        volume: 120,
      },
      {
        ts: Date.parse('2026-11-11T14:00:00Z'),
        open: 348.06,
        high: 354.39,
        low: 348.03,
        close: 353.555,
        volume: 310233,
      },
      {
        ts: Date.parse('2026-11-11T15:00:00Z'),
        open: 353.58,
        high: 354.01,
        low: 352.85,
        close: 353.615,
        volume: 217080,
      },
    ]);
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const [firstUrl, init] = calls[0] ?? ['', {}];
    expect(firstUrl).toContain('/v2/stocks/AAPL/bars?timeframe=1Hour');
    expect(firstUrl).toContain('feed=iex');
    expect(firstUrl).not.toContain('s3cret');
    expect(init.headers).toEqual({ 'APCA-API-KEY-ID': 'PKTEST', 'APCA-API-SECRET-KEY': 's3cret' });
    expect(calls[1]?.[0]).toContain('page_token=QUFQTHxNfDE3OTQ0MTI4MDAwMDAwMDAwMDA%3D');
  });

  it('turns a 401 from history into FeedAuthError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const { adapter } = harness((ctx, createSocket) => new AlpacaAdapter(ctx, createSocket), KEYS);
    await expect(adapter.fetchHistory(AAPL, '1d', 0, Date.now())).rejects.toBeInstanceOf(
      FeedAuthError,
    );
  });
});
