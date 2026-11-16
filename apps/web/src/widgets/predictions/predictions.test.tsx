import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubRequest } from '../../feeds/protocol';
import { connectFeed, disconnectFeed } from '../../store/feedClient';
import { classifyEvents } from '../../store/predictions/classify';
import fixture from '../../store/predictions/fixtures/gamma-events.json';
import { usePredictionStore } from '../../store/predictions/store';
import Predictions from './index';

const props = (query = '') =>
  ({ params: { query }, api: { id: 'predictions-1' } }) as unknown as IDockviewPanelProps<{
    query: string;
  }>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-17T12:00:00Z'));
  const sent: HubRequest[] = [];
  connectFeed({ postMessage: (message) => sent.push(message), onmessage: null });
  // FRED (2-year yield) and odds history answer with nothing; the panel must still render.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ series: {}, history: [] })));
  usePredictionStore.setState({
    state: 'ready',
    events: classifyEvents(fixture),
    failure: undefined,
    loadedAt: Date.now(),
    midpoints: {},
    oddsAt: null,
  });
});

afterEach(() => {
  disconnectFeed();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Event odds', () => {
  it('labels odds as market odds, not forecasts, and groups events by theme and region', () => {
    render(<Predictions {...props()} />);
    expect(screen.getByText('Market odds, not forecasts')).toBeInTheDocument();
    expect(screen.getByText('Polymarket')).toBeInTheDocument();

    const banks = screen.getByRole('region', { name: 'Central banks' });
    expect(
      within(banks).getByRole('region', { name: 'Central banks: United States' }),
    ).toBeInTheDocument();
    expect(within(banks).getByText('Fed Decision in December?')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Conflict and sanctions: Asia-Pacific' }),
    ).toHaveTextContent('Will China invade Taiwan by end of 2026?');
    // Novelty and price-target markets never reach the panel.
    expect(screen.queryByText(/Elon Musk/)).toBeNull();
    expect(screen.queryByText(/WTI Crude Oil/)).toBeNull();
  });

  it('links the Fed decision to the 2-year yield, gold and the dollar proxy', () => {
    render(<Predictions {...props()} />);
    const row = screen.getByText('Fed Decision in December?').closest('li');
    if (!row) throw new Error('no Fed row');
    const assets = within(row).getByLabelText('Linked assets');
    expect(assets).toHaveTextContent('US 2Y');
    expect(assets).toHaveTextContent('PAXG/USD');
    expect(assets).toHaveTextContent('UUP');
  });

  it('shows live midpoints as odds once they arrive', () => {
    render(<Predictions {...props('fed decision in december')} />);
    const row = screen.getByText('Fed Decision in December?').closest('li');
    if (!row) throw new Error('no Fed row');
    const lead = usePredictionStore
      .getState()
      .events.find((event) => event.title === 'Fed Decision in December?')?.outcomes[0];
    if (!lead) throw new Error('no lead outcome');
    act(() => {
      usePredictionStore.setState({ midpoints: { [lead.tokenId]: 0.873 } });
    });
    expect(within(row).getByRole('button', { expanded: false })).toHaveTextContent('87%');
  });

  it('filters by theme', () => {
    render(<Predictions {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Shutdowns, debt and defaults' }));
    expect(screen.getByText('Government shutdown by...?')).toBeInTheDocument();
    expect(screen.queryByText('Fed Decision in December?')).toBeNull();
  });
});
