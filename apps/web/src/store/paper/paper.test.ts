import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyVault } from '../keys';
import { looksLikeLiveKey, PAPER_ORIGIN, PaperOnlyError, paperRequest, paperUrl } from './client';
import fixture from './fixtures/paper-account.json';
import { orderBody, parseAccount, parseOrders, parsePositions } from './parse';
import { cancelPaperOrder, placePaperOrder, refreshPaper, usePaperStore } from './store';

/**
 * Recorded 17 Nov 2026 from a real Alpaca paper account (ids and account number replaced): the
 * account, an empty position list, a limit and a market order (both cancelled afterwards) and a
 * rejected order. The position example follows Alpaca's OpenAPI schema (decimal strings).
 */
const POSITION = {
  symbol: 'AAPL',
  side: 'long',
  qty: '10',
  avg_entry_price: '340.00',
  current_price: '351.90',
  market_value: '3519.00',
  unrealized_pl: '119.00',
  unrealized_plpc: '0.035',
  unrealized_intraday_pl: '-12.50',
};

describe('paper-only client', () => {
  it('builds only paper URLs and refuses anything that would leave the paper origin', () => {
    expect(paperUrl('/v2/orders').href).toBe(`${PAPER_ORIGIN}/v2/orders`);
    expect(() => paperUrl('https://example.com/v2/orders')).toThrow(PaperOnlyError);
    expect(() => paperUrl('//example.com/v2/orders')).toThrow(PaperOnlyError);
    expect(() => paperUrl('/v1/orders')).toThrow(PaperOnlyError);
  });

  it('never sends a live-trading key, not even to the paper endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(looksLikeLiveKey('AKXXXXXXXX')).toBe(true);
    expect(looksLikeLiveKey('PKXXXXXXXX')).toBe(false);
    await expect(paperRequest({ id: 'AKLIVE', secret: 's' }, '/v2/account')).rejects.toThrow(
      PaperOnlyError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('paper account answers', () => {
  it('reads the account, positions and orders Alpaca sends as decimal strings', () => {
    expect(parseAccount(fixture.account)).toMatchObject({
      status: 'ACTIVE',
      equity: 100000,
      lastEquity: 100000,
    });
    expect(parsePositions(fixture.positions)).toEqual([]);
    expect(parsePositions([POSITION])).toEqual([
      expect.objectContaining({
        symbol: 'AAPL',
        qty: 10,
        avgEntry: 340,
        unrealizedPl: 119,
        unrealizedPlPct: 0.035,
      }),
    ]);
    expect(parseOrders(fixture.openOrders).map((order) => [order.type, order.status])).toEqual([
      ['market', 'accepted'],
      ['limit', 'accepted'],
    ]);
  });

  it('builds day orders in whole shares with tick-sized limit prices', () => {
    expect(orderBody({ symbol: 'AAPL', side: 'buy', type: 'market', qty: 3 })).toEqual({
      body: { symbol: 'AAPL', qty: '3', side: 'buy', type: 'market', time_in_force: 'day' },
    });
    expect(
      orderBody({ symbol: 'AAPL', side: 'sell', type: 'limit', qty: 1, limitPrice: 351.9 }),
    ).toEqual({
      body: {
        symbol: 'AAPL',
        qty: '1',
        side: 'sell',
        type: 'limit',
        time_in_force: 'day',
        limit_price: '351.90',
      },
    });
    expect(
      orderBody({ symbol: 'AAPL', side: 'buy', type: 'limit', qty: 1, limitPrice: 12.345 }),
    ).toHaveProperty('error');
    expect(orderBody({ symbol: 'AAPL', side: 'buy', type: 'market', qty: 0.5 })).toHaveProperty(
      'error',
    );
    expect(orderBody({ symbol: 'BTC-USD', side: 'buy', type: 'market', qty: 1 })).toHaveProperty(
      'error',
    );
  });
});

describe('paper store', () => {
  let calls: { url: string; method: string; body: unknown }[];

  beforeEach(() => {
    calls = [];
    useKeyVault.setState({ keys: { alpaca: 'PKTESTKEY:secret' } });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: URL, init: RequestInit) => {
        const url = input.toString();
        const method = init.method ?? 'GET';
        calls.push({
          url,
          method,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        const json = (body: unknown, status = 200) =>
          Promise.resolve(new Response(JSON.stringify(body), { status }));
        if (method === 'POST') {
          return (init.body as string).includes('"qty":"0"')
            ? json(fixture.rejected.body, 422)
            : json(fixture.limitOrder);
        }
        if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
        if (url.includes('/v2/account')) return json(fixture.account);
        if (url.includes('/v2/positions')) return json([POSITION]);
        return json(fixture.openOrders);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useKeyVault.setState({ keys: {} });
  });

  it('loads account, positions and open orders from the paper origin only', async () => {
    await refreshPaper();
    expect(usePaperStore.getState()).toMatchObject({
      state: 'ready',
      positions: [expect.objectContaining({ symbol: 'AAPL' })],
    });
    expect(calls.every((call) => call.url.startsWith(`${PAPER_ORIGIN}/v2/`))).toBe(true);
  });

  it('places and cancels paper orders, and passes Alpaca’s reason back when one is refused', async () => {
    const placed = await placePaperOrder({
      symbol: 'AAPL',
      side: 'buy',
      type: 'limit',
      qty: 1,
      limitPrice: 1,
    });
    expect(placed).toMatchObject({ ok: true, order: { symbol: 'AAPL', type: 'limit' } });
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      limit_price: '1.00',
      time_in_force: 'day',
    });

    expect(await cancelPaperOrder('order-1')).toEqual({ ok: true });
    expect(
      calls.some(
        (call) => call.method === 'DELETE' && call.url === `${PAPER_ORIGIN}/v2/orders/order-1`,
      ),
    ).toBe(true);

    // The ticket refuses a zero quantity itself, so this checks Alpaca's own refusal path.
    const refused = await paperRequest({ id: 'PKTESTKEY', secret: 'secret' }, '/v2/orders', {
      method: 'POST',
      body: { symbol: 'AAPL', qty: '0', side: 'buy', type: 'market', time_in_force: 'day' },
    }).catch((error: unknown) => (error instanceof Error ? error.message : ''));
    expect(refused).toBe('qty must be > 0');
  });

  it('says so instead of trading when the saved key is a live key', async () => {
    useKeyVault.setState({ keys: { alpaca: 'AKLIVEKEY:secret' } });
    await refreshPaper();
    expect(usePaperStore.getState().state).toBe('live-key');
    expect(
      await placePaperOrder({ symbol: 'AAPL', side: 'buy', type: 'market', qty: 1 }),
    ).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});
