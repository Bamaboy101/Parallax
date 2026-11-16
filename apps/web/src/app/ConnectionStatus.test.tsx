import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SourceStatus } from '../feeds/protocol';
import { resetTicks, setStatuses } from '../store/ticks';
import { ConnectionStatus } from './ConnectionStatus';

const status = (source: string, patch: Partial<SourceStatus>): SourceStatus => ({
  source,
  state: 'live',
  lastEventAt: 1,
  latencyMs: 40,
  stale: false,
  attempt: 0,
  retryAt: null,
  serving: [],
  symbolLimit: null,
  waiting: [],
  pollMs: null,
  ...patch,
});

afterEach(() => {
  resetTicks();
});

describe('ConnectionStatus', () => {
  it('names the feed whose free symbol cap leaves symbols waiting', () => {
    render(<ConnectionStatus />);
    act(() => {
      setStatuses([
        status('coinbase', {}),
        status('alpaca', { symbolLimit: 30, waiting: ['NFLX', 'XOM'] }),
      ]);
    });

    const notice = screen.getByText('Alpaca limit · 2 symbols waiting');
    expect(notice).toHaveAttribute('title', expect.stringContaining('Not streaming: NFLX, XOM'));
    expect(screen.getByText('2 live')).toBeInTheDocument();
  });
});
