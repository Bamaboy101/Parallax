import { act, render, screen } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubRequest } from '../../feeds/protocol';
import { connectFeed, disconnectFeed } from '../../store/feedClient';
import { ingest, resetTicks } from '../../store/ticks';
import Derivatives from './index';

const sent: HubRequest[] = [];
const props = { api: { id: 'derivs-1' }, params: {} } as unknown as IDockviewPanelProps;

beforeEach(() => {
  sent.length = 0;
  connectFeed({ postMessage: (message) => sent.push(message), onmessage: null });
});

afterEach(() => {
  disconnectFeed();
  resetTicks();
  vi.useRealTimers();
});

describe('Crypto derivatives board', () => {
  it('subscribes funding and liquidations for every perp', () => {
    render(<Derivatives {...props} />);
    const subscribed = sent
      .filter((message) => message.type === 'subscribe')
      .map((message) => `${message.symbol.id}|${message.channel}`);
    for (const base of ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE']) {
      expect(subscribed).toContain(`${base}-USDT-PERP|deriv`);
      expect(subscribed).toContain(`${base}-USDT-PERP|liquidation`);
    }
  });

  it('shows funding as a percent, open interest in USD, and totals liquidations by side', () => {
    vi.useFakeTimers();
    render(<Derivatives {...props} />);
    const now = Date.now();
    const base = { source: 'bybit', receivedAt: now } as const;
    act(() => {
      ingest([
        {
          ...base,
          channel: 'deriv',
          symbol: 'BTC-USDT-PERP',
          ts: now,
          markPrice: 64783.2,
          fundingRate: 0.0001,
          nextFundingTime: now + 3 * 3_600_000,
          openInterest: 69990,
          openInterestUsd: 4_534_224_665,
        },
        {
          ...base,
          channel: 'liquidation',
          symbol: 'BTC-USDT-PERP',
          ts: now - 2000,
          side: 'short',
          price: 65000,
          size: 2,
        },
        {
          ...base,
          channel: 'liquidation',
          symbol: 'ETH-USDT-PERP',
          ts: now - 1000,
          side: 'long',
          price: 1800,
          size: 10,
        },
      ]);
    });
    // The liquidation list refreshes at most ten times a second.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const btc = screen
      .getByText('BTC', { selector: '.derivs-columns .market-symbol' })
      .closest('li');
    expect(btc?.textContent).toContain('+0.0100%');
    expect(btc?.textContent).toContain('$4.53B');
    expect(btc?.textContent).toMatch(/[23]h \d\dm/);
    // Newest first: ETH's long liquidation, then BTC's short one.
    const rows = [...document.querySelectorAll('.liquidation-columns.market-row')];
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('ETHLong'),
      expect.stringContaining('BTCShort'),
    ]);
    expect(screen.getByText(/last hour: longs \$18K · shorts \$130K/)).toBeTruthy();
  });
});
