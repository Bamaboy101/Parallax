import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubRequest } from '../../feeds/protocol';
import { connectFeed, disconnectFeed } from '../../store/feedClient';
import { useKeyVault } from '../../store/keys';
import { PAPER_ORIGIN } from '../../store/paper/client';
import fixture from '../../store/paper/fixtures/paper-account.json';
import { instrument } from '../../store/symbols';
import { PaperTicket } from '../PaperTicket';
import Paper from './index';

const props = { api: { id: 'paper-1' }, params: {} } as unknown as IDockviewPanelProps;
const POSITION = {
  symbol: 'AAPL',
  side: 'long',
  qty: '10',
  avg_entry_price: '340.00',
  current_price: '351.90',
  market_value: '3519.00',
  unrealized_pl: '119.00',
  unrealized_plpc: '0.035',
};
let calls: { url: string; method: string; body: string | undefined }[];

beforeEach(() => {
  calls = [];
  const ignore = (message: HubRequest) => message;
  connectFeed({ postMessage: ignore, onmessage: null });
  useKeyVault.setState({ keys: { alpaca: 'PKTESTKEY:secret' } });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: URL, init: RequestInit) => {
      const url = input.toString();
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: typeof init.body === 'string' ? init.body : undefined });
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
      if (method === 'POST') return json(fixture.limitOrder);
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes('/v2/account')) return json(fixture.account);
      if (url.includes('/v2/positions')) return json([POSITION]);
      return json(fixture.openOrders);
    }),
  );
});

afterEach(() => {
  disconnectFeed();
  vi.unstubAllGlobals();
  useKeyVault.setState({ keys: {} });
});

describe('Paper trading panel', () => {
  it('shows the paper account, positions with profit and loss, and cancels an open order', async () => {
    render(<Paper {...props} />);
    expect(
      screen.getByText('Fake money · Alpaca paper · live trading is not possible here'),
    ).toBeInTheDocument();
    const positions = await screen.findByRole('region', { name: 'Positions' });
    expect(within(positions).getByText('AAPL').closest('li')).toHaveTextContent('+119.00');

    const orders = screen.getByRole('region', { name: 'Open orders' });
    const [firstCancel] = within(orders).getAllByRole('button', { name: 'Cancel' });
    if (!firstCancel) throw new Error('no open orders');
    fireEvent.click(firstCancel);
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    });
    expect(calls.every((call) => call.url.startsWith(PAPER_ORIGIN))).toBe(true);
  });

  it('asks for the paper key when none is saved', () => {
    useKeyVault.setState({ keys: {} });
    render(<Paper {...props} />);
    expect(
      screen.getByText('Add your free Alpaca paper key to trade with fake money'),
    ).toBeInTheDocument();
  });
});

describe('Paper ticket on the chart', () => {
  it('sends a limit order as a paper day order and reports Alpaca’s status', async () => {
    const item = instrument('AAPL');
    if (!item) throw new Error('AAPL missing');
    render(<PaperTicket item={item} onClose={() => undefined} />);
    expect(screen.getByText('Fake money · Alpaca paper account')).toBeInTheDocument();
    // The ticket shows its controls once the saved key has been read.
    fireEvent.click(await screen.findByRole('button', { name: 'Limit' }));
    fireEvent.change(screen.getByLabelText('Limit $'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place paper buy' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Paper buy 1 AAPL limit 1: accepted/,
    );
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.url).toBe(`${PAPER_ORIGIN}/v2/orders`);
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
      type: 'limit',
      limit_price: '1.00',
      time_in_force: 'day',
    });
  });
});
