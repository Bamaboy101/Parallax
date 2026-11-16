import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedAuthError, type SymbolRef } from '../types';
import { FinnhubAdapter } from './finnhub';
import recording from './fixtures/finnhub.jsonl?raw';
import companyNews from './fixtures/finnhub-news.json?raw';
import { harness } from './testing';

const AAPL: SymbolRef = { id: 'AAPL', kind: 'equity', base: 'AAPL', quote: 'USD' };
/**
 * Recorded 16 Nov 2026 with a free key while US markets were closed, on Finnhub's always-on
 * Binance symbol. Stock trades share this message format, so the ticker stands in for one.
 */
const RECORDED: SymbolRef = {
  id: 'BINANCE:BTCUSDT',
  kind: 'equity',
  base: 'BINANCE:BTCUSDT',
  quote: 'USD',
};
const KEYS = { finnhub: 'tok/en' };

function create() {
  return harness((ctx, createSocket) => new FinnhubAdapter(ctx, createSocket), KEYS);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FinnhubAdapter', () => {
  it('streams one upstream subscription per ticker, shared by trades and bars', () => {
    const { adapter, socket } = create();
    adapter.subscribe(AAPL, 'trade');
    adapter.subscribe(AAPL, 'quote');
    void adapter.connect();
    expect(socket().url).toBe('wss://ws.finnhub.io?token=tok%2Fen');
    socket().open();
    adapter.subscribe(AAPL, 'bar');
    expect(socket().sent).toEqual([{ type: 'subscribe', symbol: 'AAPL' }]);

    adapter.unsubscribe(AAPL, 'trade');
    expect(socket().sent).toHaveLength(1);
    adapter.unsubscribe(AAPL, 'bar');
    expect(socket().sent.at(-1)).toEqual({ type: 'unsubscribe', symbol: 'AAPL' });
  });

  it('normalises a recorded session', () => {
    const { adapter, socket, byChannel, logs } = create();
    adapter.subscribe(RECORDED, 'trade');
    adapter.subscribe(RECORDED, 'bar');
    void adapter.connect();
    socket().open();
    socket().replay(recording);

    expect(logs).toEqual([]);
    const trades = byChannel('trade');
    expect(trades).toHaveLength(285);
    expect(trades[0]).toEqual({
      channel: 'trade',
      symbol: 'BINANCE:BTCUSDT',
      source: 'finnhub',
      price: 65094.01,
      size: 0.00065,
      ts: 1794799216120,
      receivedAt: expect.any(Number) as number,
    });
    expect(byChannel('bar').at(-1)).toMatchObject({
      ts: 1794799200000,
      open: 65094.01,
      high: 65106.01,
      low: 65094.01,
      close: 65106.01,
      interval: '1m',
    });
  });

  it('reports a refused handshake as a bad key when REST refuses it too', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'Invalid API key.' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { adapter, socket } = create();
    const done = adapter.connect();
    socket().close(1006);

    await expect(done).rejects.toBeInstanceOf(FeedAuthError);
    const [url] = (fetchMock.mock.calls[0] ?? []) as [string];
    expect(url).toBe('https://finnhub.io/api/v1/quote?symbol=AAPL&token=tok%2Fen');
  });

  it('keeps a refused handshake retryable when REST accepts the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ c: 228.4 })));
    const { adapter, socket } = create();
    const done = adapter.connect();
    socket().close(1006);

    const error: unknown = await done.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(FeedAuthError);
  });

  it('normalises recorded company news, newest first, for the requested days', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(companyNews));
    vi.stubGlobal('fetch', fetchMock);
    const { adapter } = create();

    const items = await adapter.fetchNews(
      AAPL,
      Date.parse('2026-11-13T12:00:00Z'),
      Date.parse('2026-11-16T12:00:00Z'),
    );

    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      title: expect.stringContaining('AAPL Stock Posted Best Week In 4 Months') as string,
      url: expect.stringMatching(/^https:\/\/finnhub\.io\/api\/news\?id=/) as string,
      source: 'Yahoo',
      published: 1794815165000,
      summary: expect.stringContaining('smart glasses') as string,
    });
    expect(items.map((item) => item.published)).toEqual([
      1794815165000, 1794808800000, 1794807120000,
    ]);
    const [url] = (fetchMock.mock.calls[0] ?? []) as [string];
    expect(url).toBe(
      'https://finnhub.io/api/v1/company-news?symbol=AAPL&from=2026-11-13&to=2026-11-16&token=tok%2Fen',
    );
  });
});
