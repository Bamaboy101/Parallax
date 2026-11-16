import { act, render, screen, within } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HubRequest, SourceStatus } from '../../feeds/protocol';
import { connectFeed, disconnectFeed } from '../../store/feedClient';
import { useKeyVault } from '../../store/keys';
import { instrument } from '../../store/symbols';
import { ingest, resetTicks, setStatuses } from '../../store/ticks';
import Markets from './index';
import { GROUPS } from './meta';

const sent: HubRequest[] = [];
const props = { api: { id: 'markets-1' }, params: {} } as unknown as IDockviewPanelProps;

const status = (source: string, serving: string[], pollMs: number | null = null): SourceStatus => ({
  source,
  state: 'live',
  lastEventAt: 1,
  latencyMs: 40,
  stale: false,
  attempt: 0,
  retryAt: null,
  serving,
  symbolLimit: null,
  waiting: [],
  pollMs,
  key: 'alpaca',
  rateLimited: false,
});

beforeEach(() => {
  sent.length = 0;
  connectFeed({ postMessage: (message) => sent.push(message), onmessage: null });
});

afterEach(() => {
  disconnectFeed();
  resetTicks();
  useKeyVault.setState({ keys: {} });
});

describe('World markets board', () => {
  it('lists every proxy, grouped and labelled, and says a key is needed when there is none', () => {
    for (const group of GROUPS) {
      for (const row of group.rows) expect(instrument(row.id)?.kind).toBe('equity');
    }
    render(<Markets {...props} />);
    const indices = screen.getByRole('region', { name: 'World indices' });
    expect(within(indices).getAllByRole('listitem')).toHaveLength(10);
    const japan = within(indices).getByText('Japan').closest('li');
    expect(japan?.textContent).toContain('EWJ');
    expect(japan?.textContent).toContain('proxy');
    expect(screen.getAllByText('proxy')).toHaveLength(31);

    // The hub reports the stock feeds idle with no key stored.
    act(() => {
      setStatuses([
        { ...status('alpaca', []), state: 'idle' },
        { ...status('finnhub', []), state: 'idle', key: 'finnhub' },
        { ...status('alpaca-poll', [], 15_000), state: 'idle' },
      ]);
    });
    expect(screen.getByText('Add a free Alpaca or Finnhub key to see these ETFs')).toBeTruthy();
    expect(screen.getAllByText('Needs key')).toHaveLength(31);
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy();
  });

  it('subscribes every row and labels each by the feed serving it now', () => {
    useKeyVault.setState({ keys: { alpaca: 'ID:SECRET' } });
    render(<Markets {...props} />);
    const trades = sent.filter((message) => message.type === 'subscribe');
    expect(trades).toHaveLength(31);
    expect(screen.queryByText(/add a free Alpaca/)).toBeNull();

    const now = Date.now();
    act(() => {
      // DBA's last print came from the stream, but the hub has since moved it to the poller.
      ingest([
        {
          channel: 'trade',
          symbol: 'DBA',
          source: 'alpaca',
          ts: now,
          receivedAt: now,
          price: 26.1,
          size: 1,
        },
      ]);
      setStatuses([status('alpaca', ['EWJ']), status('alpaca-poll', ['DBA'], 15_000)]);
    });
    const row = (market: string) => screen.getByText(market).closest('li')?.textContent ?? '';
    expect(row('Japan')).toContain('stream');
    expect(row('Agriculture')).toContain('poll');
    expect(row('Silver')).toContain('—');
  });
});
