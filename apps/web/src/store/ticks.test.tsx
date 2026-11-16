import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubMessage, HubRequest } from '../feeds/protocol';
import type { FeedEvent, QuoteEvent, SymbolRef, TradeEvent } from '../feeds/types';
import { connectFeed, disconnectFeed, type FeedPort } from './feedClient';
import { LIST_REFRESH_MS, useCursor, useTick, useTrades } from './hooks';
import { REWIND_MS, ingest, recentValues, resetTicks, setCursor, useTickStore } from './ticks';

const BTC: SymbolRef = { id: 'BTC-USD', kind: 'crypto', base: 'BTC', quote: 'USD' };
const ETH: SymbolRef = { id: 'ETH-USD', kind: 'crypto', base: 'ETH', quote: 'USD' };
const T0 = 1_800_000_000_000;

const trade = (symbol: string, price: number, receivedAt: number): TradeEvent => ({
  channel: 'trade',
  symbol,
  price,
  size: 1,
  ts: receivedAt,
  receivedAt,
  source: 'coinbase',
});
const quote = (bid: number, receivedAt: number): QuoteEvent => ({
  channel: 'quote',
  symbol: 'BTC-USD',
  bid,
  bidSize: 1,
  ask: bid + 1,
  askSize: 1,
  ts: receivedAt,
  receivedAt,
  source: 'coinbase',
});

let sent: HubRequest[];
let port: FeedPort;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetTicks();
  sent = [];
  port = { postMessage: (message) => sent.push(message), onmessage: null };
  connectFeed(port);
});

afterEach(() => {
  disconnectFeed();
  vi.useRealTimers();
});

/** Deliver a batch the way the worker does. */
function deliver(events: FeedEvent[]) {
  act(() => {
    port.onmessage?.(new MessageEvent<HubMessage>('message', { data: { type: 'events', events } }));
  });
}

describe('useTick', () => {
  it('subscribes while mounted and releases on unmount', async () => {
    function Price() {
      useTick(BTC, 'trade');
      return null;
    }
    const view = render(<Price />);
    expect(sent).toEqual([{ type: 'subscribe', symbol: BTC, channel: 'trade', background: false }]);
    view.unmount();
    await Promise.resolve();
    expect(sent.at(-1)).toEqual({
      type: 'unsubscribe',
      symbol: BTC,
      channel: 'trade',
      background: false,
    });
  });

  it('takes the new subscription before releasing the old one when visibility changes', async () => {
    function Price({ background }: { background: boolean }) {
      useTick(BTC, 'trade', background);
      return null;
    }
    const view = render(<Price background={false} />);
    view.rerender(<Price background />);
    await Promise.resolve();
    // The hub's count never reaches zero, so the stream is not torn down in between.
    expect(
      sent.map((message) => [message.type, 'background' in message && message.background]),
    ).toEqual([
      ['subscribe', false],
      ['subscribe', true],
      ['unsubscribe', false],
    ]);
  });

  it('re-renders only the cell whose value changed', () => {
    const renders = { BTC: 0, ETH: 0 };
    function Cell({ symbol }: { symbol: SymbolRef }) {
      const last = useTick(symbol, 'trade');
      renders[symbol.base as 'BTC' | 'ETH'] += 1;
      return <span data-testid={symbol.id}>{last?.price ?? '-'}</span>;
    }
    const view = render(
      <>
        <Cell symbol={BTC} />
        <Cell symbol={ETH} />
      </>,
    );
    expect(renders).toEqual({ BTC: 1, ETH: 1 });

    deliver([trade('BTC-USD', 100, T0), trade('BTC-USD', 101, T0 + 1)]);
    expect(view.getByTestId('BTC-USD').textContent).toBe('101');
    expect(renders).toEqual({ BTC: 2, ETH: 1 });

    deliver([trade('ETH-USD', 5, T0 + 2)]);
    expect(renders).toEqual({ BTC: 2, ETH: 2 });
  });
});

describe('Rewind', () => {
  it('shows every widget the value at the cursor, then live again', () => {
    function Last() {
      const last = useTick(BTC, 'trade');
      const [cursor] = useCursor();
      return (
        <span data-testid="last">
          {last?.price}@{cursor === null ? 'live' : 'rewind'}
        </span>
      );
    }
    const view = render(<Last />);
    deliver([trade('BTC-USD', 100, T0 - 30_000), trade('BTC-USD', 110, T0 - 10_000)]);
    deliver([trade('BTC-USD', 120, T0)]);
    expect(view.getByTestId('last').textContent).toBe('120@live');

    act(() => {
      setCursor(T0 - 15_000);
    });
    expect(view.getByTestId('last').textContent).toBe('100@rewind');

    // Live data keeps arriving underneath without moving the rewound view.
    deliver([trade('BTC-USD', 130, T0 + 1)]);
    expect(view.getByTestId('last').textContent).toBe('100@rewind');

    act(() => {
      setCursor(null);
    });
    expect(view.getByTestId('last').textContent).toBe('130@live');
  });

  it('clamps the cursor to the last hour and treats the future as live', () => {
    setCursor(T0 - 2 * REWIND_MS);
    expect(useTickStore.getState().cursor).toBe(T0 - REWIND_MS);
    setCursor(T0 + 5000);
    expect(useTickStore.getState().cursor).toBeNull();
  });

  it('lists recent trades at the cursor, newest first, at most ten times a second', () => {
    function Tape() {
      const trades = useTrades(BTC, 2);
      return <span data-testid="tape">{trades.map((t) => t.price).join(',')}</span>;
    }
    const view = render(<Tape />);
    deliver([1, 2, 3, 4].map((n) => trade('BTC-USD', n, T0 - 1000 * (5 - n))));
    expect(view.getByTestId('tape').textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(LIST_REFRESH_MS);
    });
    expect(view.getByTestId('tape').textContent).toBe('4,3');
    act(() => {
      setCursor(T0 - 2500);
    });
    expect(view.getByTestId('tape').textContent).toBe('2,1');
  });
});

describe('history retention', () => {
  it('drops data older than an hour', () => {
    ingest([trade('BTC-USD', 1, T0 - REWIND_MS - 1)]);
    ingest([trade('BTC-USD', 2, T0)]);
    expect(recentValues('trade', 'BTC-USD', 10, null).map((t) => t.price)).toEqual([2]);
  });

  it('keeps one quote per 250 ms bucket, the newest in it', () => {
    ingest([quote(1, T0), quote(2, T0 + 100), quote(3, T0 + 249)]);
    ingest([quote(4, T0 + 250), quote(5, T0 + 400)]);
    expect(recentValues('quote', 'BTC-USD', 10, null).map((q) => q.bid)).toEqual([5, 3]);
  });

  it('keeps one entry per bar, updated until the bar closes', () => {
    const bar = (ts: number, close: number, receivedAt: number): FeedEvent => ({
      channel: 'bar',
      interval: '1m',
      symbol: 'BTC-USD',
      ts,
      open: 1,
      high: 1,
      low: 1,
      close,
      volume: 1,
      receivedAt,
      source: 'coinbase',
    });
    ingest([bar(T0, 10, T0 + 1), bar(T0, 11, T0 + 2), bar(T0 + 60_000, 12, T0 + 60_001)]);
    // A late update for the closed bar is ignored.
    ingest([bar(T0, 99, T0 + 60_002)]);
    expect(recentValues('bar', 'BTC-USD', 10, null).map((b) => b.close)).toEqual([12, 11]);
  });
});
