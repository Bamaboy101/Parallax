import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataRequest, dataUrl } from './client';
import fixture from './fixtures/spy-chain.json';
import {
  atTheMoney,
  chainRows,
  parseChain,
  parseOcc,
  parseSnapshot,
  putCallRatio,
  smile,
  type OptionQuote,
} from './parse';
import { defaultExpiry } from './store';

/** A real SPY chain from Alpaca's indicative feed (17 Nov 2026), strikes 716–744. */
const quotes = parseChain(fixture).quotes;

const quote = (over: Partial<OptionQuote>): OptionQuote => ({
  symbol: 'X',
  type: 'call',
  strike: 100,
  expiry: '2026-11-20',
  bid: 1,
  ask: 1.1,
  last: 1,
  lastAt: 0,
  quoteAt: 0,
  iv: 0.3,
  delta: 0.5,
  volume: 0,
  volumeDay: '2026-11-17',
  ...over,
});

describe('option chain parsing', () => {
  it('reads OCC symbols', () => {
    expect(parseOcc('SPY261120C00730000')).toEqual({
      root: 'SPY',
      expiry: '2026-11-20',
      type: 'call',
      strike: 730,
    });
    expect(parseOcc('BRK.B261120P00492500')?.strike).toBe(492.5);
    expect(parseOcc('not-an-option')).toBeNull();
  });

  it('reads the real chain: quotes, IV, delta and the session volume', () => {
    expect(quotes).toHaveLength(16);
    const call = quotes.find((entry) => entry.symbol === 'SPY261120C00728000');
    expect(call).toMatchObject({ type: 'call', strike: 728, expiry: '2026-11-20' });
    expect(call?.iv).toBeGreaterThan(0.2);
    expect(call?.delta).toBeGreaterThan(0);
    expect(call?.volumeDay).toBe('2026-11-17');
  });

  it('treats a zero bid as no bid', () => {
    expect(
      parseSnapshot('SPY261120C00730000', { latestQuote: { bp: 0, ap: 1.2 } })?.bid,
    ).toBeNull();
  });

  it('pairs calls and puts by strike, lowest first', () => {
    const rows = chainRows(quotes);
    expect(rows.map((row) => row.strike)).toEqual([716, 720, 724, 728, 732, 736, 740, 744]);
    expect(rows.every((row) => row.call?.type === 'call' && row.put?.type === 'put')).toBe(true);
    expect(atTheMoney(rows, 729.8)).toBe(728);
  });

  it('draws the smile from out-of-the-money options only', () => {
    const rows = chainRows([
      quote({ type: 'put', strike: 90, iv: 0.4 }),
      quote({ type: 'call', strike: 90, iv: 0.9 }),
      quote({ type: 'put', strike: 110, iv: 0.9 }),
      quote({ type: 'call', strike: 110, iv: 0.25 }),
      quote({ type: 'call', strike: 120, iv: null }),
    ]);
    expect(smile(rows, 100)).toEqual([
      { strike: 90, iv: 0.4, type: 'put' },
      { strike: 110, iv: 0.25, type: 'call' },
    ]);
  });

  it('counts the put/call ratio in the latest session only', () => {
    const result = putCallRatio([
      quote({ type: 'call', volume: 100 }),
      quote({ type: 'put', volume: 150 }),
      // Last traded on an earlier day: its daily bar is not today's volume.
      quote({ type: 'put', volume: 5000, volumeDay: '2026-11-13' }),
    ]);
    expect(result).toEqual({ callVolume: 100, putVolume: 150, ratio: 1.5, day: '2026-11-17' });
    expect(putCallRatio([quote({ type: 'put', volume: 3 })]).ratio).toBeNull();
  });

  it('opens on the first expiry after today in New York', () => {
    // 17 Nov 2026, 15:00 New York.
    const now = Date.parse('2026-11-17T20:00:00Z');
    expect(defaultExpiry(['2026-11-17', '2026-11-18', '2026-11-20'], now)).toBe('2026-11-18');
    expect(defaultExpiry(['2026-11-17'], now)).toBe('2026-11-17');
    expect(defaultExpiry([], now)).toBeNull();
  });
});

describe('market data client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only builds Alpaca market data URLs', () => {
    expect(dataUrl('/v1beta1/options/snapshots/SPY', { feed: 'indicative' }).href).toBe(
      'https://data.alpaca.markets/v1beta1/options/snapshots/SPY?feed=indicative',
    );
    expect(() => dataUrl('/v2/orders')).toThrow();
    expect(() => dataUrl('//evil.example/v2/stocks/SPY')).toThrow();
  });

  it('sends the key only to the data host and explains a refused key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: 'forbidden.' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(dataRequest('PKTEST:SECRET', '/v2/stocks/SPY/snapshot')).rejects.toThrow(
      'forbidden.',
    );
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe('https://data.alpaca.markets');
    expect(init.headers).toEqual({ 'APCA-API-KEY-ID': 'PKTEST', 'APCA-API-SECRET-KEY': 'SECRET' });
  });
});
