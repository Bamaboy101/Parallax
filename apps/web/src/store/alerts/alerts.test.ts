import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedEvent } from '../../feeds/types';
import { ingest, resetTicks } from '../ticks';
import { describeRule, parseAlert, resolveSymbol } from './parse';
import { checkAlerts, conditionHolds, nextState, useAlerts, type Alert } from './store';

describe('parseAlert', () => {
  it.each([
    ['BTC above 65000', { kind: 'level', symbol: 'BTC-USD', direction: 'above', level: 65_000 }],
    ['alert eth > 2k', { kind: 'level', symbol: 'ETH-USD', direction: 'above', level: 2_000 }],
    ['AAPL below $180.50', { kind: 'level', symbol: 'AAPL', direction: 'below', level: 180.5 }],
    ['eur/usd under 1.08', { kind: 'level', symbol: 'EUR-USD', direction: 'below', level: 1.08 }],
    [
      'ETH down 2% in 15m',
      { kind: 'move', symbol: 'ETH-USD', direction: 'down', percent: 2, windowMs: 900_000 },
    ],
    [
      'when SOL moves 3 % within an hour',
      { kind: 'move', symbol: 'SOL-USD', direction: 'either', percent: 3, windowMs: 3_600_000 },
    ],
    ['BTC up 5% today', { kind: 'day', symbol: 'BTC-USD', direction: 'up', percent: 5 }],
  ])('reads “%s”', (text, rule) => {
    expect(parseAlert(text)).toEqual({ ok: true, rule });
  });

  it('says what is wrong instead of guessing', () => {
    const reason = (text: string) => {
      const result = parseAlert(text);
      return result.ok ? null : result.reason;
    };
    expect(reason('XYZQ above 10')).toContain('No symbol');
    expect(reason('BTC above')).toContain('price');
    expect(reason('BTC down 2% in 3h')).toContain('hour');
    expect(reason('BTC sideways')).not.toBeNull();
  });

  it('never matches a symbol loosely', () => {
    expect(resolveSymbol('btc')?.id).toBe('BTC-USD');
    expect(resolveSymbol('btcusdt')?.id).toBe('BTC-USDT');
    expect(resolveSymbol('bt')).toBeUndefined();
  });

  it('describes a rule in plain words', () => {
    const parsed = parseAlert('SPY up 1% today');
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(describeRule(parsed.rule)).toBe('SPY is up 1.0% since the previous close');
  });
});

describe('alert state', () => {
  const level = { kind: 'level', symbol: 'BTC-USD', direction: 'above', level: 65_000 } as const;
  const inputs = (price: number) => ({
    price,
    source: 'coinbase',
    priceAt: () => undefined,
    dayChangePct: undefined,
  });

  it('only fires on a fresh crossing', () => {
    const alert = (status: Alert['status']): Alert => ({
      id: 'a',
      rule: level,
      createdAt: 0,
      status,
    });
    // Already above when added: waits for it to drop back first.
    expect(nextState(alert('new'), conditionHolds(level, inputs(66_000), 0))).toBe('waiting');
    expect(nextState(alert('waiting'), conditionHolds(level, inputs(64_000), 0))).toBe('armed');
    expect(nextState(alert('armed'), conditionHolds(level, inputs(65_001), 0))).toBe('fired');
    expect(nextState(alert('fired'), false)).toBe('fired');
  });

  it('judges a move only once the page has seen the start of its window', () => {
    const move = {
      kind: 'move',
      symbol: 'ETH-USD',
      direction: 'down',
      percent: 2,
      windowMs: 60_000,
    } as const;
    expect(conditionHolds(move, inputs(1_960), 100_000)).toBeUndefined();
    expect(conditionHolds(move, { ...inputs(1_960), priceAt: () => 2_000 }, 100_000)).toBe(true);
    expect(conditionHolds(move, { ...inputs(1_970), priceAt: () => 2_000 }, 100_000)).toBe(false);
  });
});

describe('checkAlerts', () => {
  const trade = (price: number, at: number): FeedEvent => ({
    channel: 'trade',
    symbol: 'BTC-USD',
    source: 'coinbase',
    ts: at,
    receivedAt: at,
    price,
    size: 1,
  });
  const notifications: { title: string; body: string }[] = [];

  beforeEach(() => {
    notifications.length = 0;
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function Notification(title: string, options: { body: string }) {
          notifications.push({ title, body: options.body });
        },
        { permission: 'granted' },
      ),
    );
  });

  afterEach(() => {
    resetTicks();
    vi.unstubAllGlobals();
    useAlerts.setState({ alerts: [] });
  });

  it('notifies once with the price, source and time when the level is crossed', () => {
    useAlerts
      .getState()
      .add({ kind: 'level', symbol: 'BTC-USD', direction: 'above', level: 65_000 });
    ingest([trade(64_900, 1_000)]);
    checkAlerts(1_000);
    expect(useAlerts.getState().alerts[0]?.status).toBe('armed');
    ingest([trade(65_010, 2_000)]);
    checkAlerts(2_000);
    checkAlerts(3_000);
    const [alert] = useAlerts.getState().alerts;
    expect(alert?.status).toBe('fired');
    expect(alert?.fired).toMatchObject({ price: 65_010, source: 'coinbase' });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe('Parallax: BTC/USD trades above 65,000.00');
    expect(notifications[0]?.body).toMatch(/^BTC\/USD at 65,010\.00 on Coinbase, /);
  });
});
