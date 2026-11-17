import { render, screen, within } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLOSSARY } from '../../design/learn';
import fixture from '../../store/options/fixtures/spy-chain.json';
import { useKeyVault } from '../../store/keys';
import Options from './index';

const props = (symbol: string) =>
  ({ api: { id: 'options-1' }, params: { symbol } }) as unknown as IDockviewPanelProps<{
    symbol?: string;
  }>;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  useKeyVault.setState({ keys: {} });
});

describe('Options panel', () => {
  it('asks for an Alpaca key first', () => {
    render(<Options {...props('SPY')} />);
    expect(screen.getByText('Add your free Alpaca key to see options')).toBeInTheDocument();
  });

  it('shows the chain around the spot, the smile and the put/call ratio, labelled indicative', async () => {
    useKeyVault.setState({ keys: { alpaca: 'PKTEST:SECRET' } });
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: URL) => {
        urls.push(url.href);
        if (url.pathname === '/v2/stocks/SPY/snapshot') {
          return Promise.resolve(
            json({ latestTrade: { p: 729.8, t: '2026-11-17T15:47:56Z', s: 100 } }),
          );
        }
        return Promise.resolve(json(fixture));
      }),
    );
    render(<Options {...props('SPY')} />);

    expect(await screen.findByLabelText('Spot 729.80')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Implied volatility by strike' })).toBeInTheDocument();
    const summary = screen.getByText('Put/call').closest('div');
    expect(summary?.textContent).toMatch(/Put\/call\d+\.\d\d/);
    expect(
      screen.getByText(/Indicative · quotes adjusted · trades 15 min late/),
    ).toBeInTheDocument();
    // Every chain request asks for the free indicative feed, from Alpaca's data host only.
    const chainUrls = urls.filter((url) => url.includes('/options/'));
    expect(chainUrls.length).toBeGreaterThan(0);
    expect(chainUrls.every((url) => url.startsWith('https://data.alpaca.markets/'))).toBe(true);
    expect(chainUrls.every((url) => url.includes('feed=indicative'))).toBe(true);
    // Learn mode can explain every column heading.
    const headings = document.querySelector('.options-panel .market-columns');
    if (!headings) throw new Error('no headings');
    for (const heading of within(headings as HTMLElement).getAllByText(/\S/)) {
      expect(GLOSSARY[heading.textContent], heading.textContent).toBeDefined();
    }
  });

  it('says options cover stocks and ETFs when given a crypto pair', () => {
    useKeyVault.setState({ keys: { alpaca: 'PKTEST:SECRET' } });
    render(<Options {...props('BTC-USD')} />);
    expect(screen.getByText(/Options cover US stocks and ETFs/)).toBeInTheDocument();
  });
});
