import { fireEvent, render, screen, within } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDGE_URL } from '../../store/edge';
import { useAiKeys } from '../../store/copilot/keys';
import { useCopilot } from '../../store/copilot/store';
import { ingest, resetTicks } from '../../store/ticks';
import Copilot from './index';

const now = Date.now();
const props = (query?: string) =>
  ({
    api: { id: 'copilot-1' },
    params: query ? { query } : {},
    containerApi: {
      panels: [
        { title: 'Watchlist', params: { symbols: ['BTC-USD'] }, api: { component: 'watchlist' } },
        { title: 'Co-pilot', params: {}, api: { component: 'copilot' } },
      ],
    },
  }) as unknown as IDockviewPanelProps<{ query?: string }>;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  ingest([
    {
      channel: 'trade',
      symbol: 'BTC-USD',
      source: 'coinbase',
      ts: now,
      receivedAt: now,
      price: 64_000,
      size: 1,
    },
  ]);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: URL | string) => {
      if (String(url).startsWith(EDGE_URL)) {
        return Promise.resolve(
          json({
            items: [
              {
                title: 'Bitcoin slips',
                url: 'https://news.example/btc',
                source: 'Wire',
                published: now,
                summary: '',
              },
            ],
            sources: [],
          }),
        );
      }
      return Promise.resolve(
        json({
          type: 'message',
          content: [{ type: 'text', text: 'BTC is at 64,000 [P1]; outflows reported [N1].' }],
        }),
      );
    }),
  );
});

afterEach(() => {
  resetTicks();
  vi.unstubAllGlobals();
  useAiKeys.setState({ keys: {}, provider: 'anthropic', models: {} });
  useCopilot.setState({ models: {}, modelsError: {} });
});

describe('Co-pilot panel', () => {
  it('asks for the user’s own key first and says where it goes', () => {
    render(<Copilot {...props()} />);
    expect(screen.getByLabelText('Anthropic API key')).toBeInTheDocument();
    expect(screen.getByText(/goes only to Anthropic, never to Parallax/)).toBeInTheDocument();
  });

  it('asks a command-bar question and lists the panels and headlines it cites', async () => {
    useAiKeys.setState({
      keys: { anthropic: 'sk-ant-x' },
      provider: 'anthropic',
      models: { anthropic: 'claude-test' },
    });
    useCopilot.setState({ models: { anthropic: ['claude-test'] }, modelsError: {} });
    render(<Copilot {...props('why is btc down')} />);

    const sources = await screen.findByRole('region', { name: 'Sources' });
    expect(sources).toHaveTextContent('Watchlist');
    expect(within(sources).getByRole('link', { name: 'Bitcoin slips' })).toHaveAttribute(
      'href',
      'https://news.example/btc',
    );
    expect(screen.getByRole('link', { name: 'P1' })).toHaveAttribute('href', '#copilot-source-P1');
  });

  it('refuses a buy or sell question in the panel', async () => {
    useAiKeys.setState({
      keys: { anthropic: 'sk-ant-x' },
      provider: 'anthropic',
      models: { anthropic: 'claude-test' },
    });
    useCopilot.setState({ models: { anthropic: ['claude-test'] }, modelsError: {} });
    render(<Copilot {...props()} />);
    fireEvent.change(screen.getByLabelText('Question for the co-pilot'), {
      target: { value: 'Should I sell ETH?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(
      await screen.findByText('The co-pilot does not give buy or sell advice'),
    ).toBeInTheDocument();
  });
});
