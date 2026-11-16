import { act, render, screen } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubMessage, HubRequest } from '../../feeds/protocol';
import { connectFeed, disconnectFeed, type FeedPort } from '../../store/feedClient';
import { EDGE_URL } from '../../store/edge';
import News from './index';

let sent: HubRequest[];
let port: FeedPort;

const props = (query: string) =>
  ({ params: { query }, api: { id: 'news-1' } }) as unknown as IDockviewPanelProps<{
    query: string;
  }>;

beforeEach(() => {
  sent = [];
  port = { postMessage: (message) => sent.push(message), onmessage: null };
  connectFeed(port);
});

afterEach(() => {
  disconnectFeed();
  vi.unstubAllGlobals();
});

describe('News', () => {
  it('searches publisher RSS by company name and merges the user’s company news for a ticker', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        items: [
          {
            title: 'Apple unveils glasses',
            url: 'https://cnbc.test/1',
            source: 'CNBC',
            published: 2000,
            summary: '',
          },
          {
            title: 'Duplicate story',
            url: 'https://dup.test/1',
            source: 'CNBC',
            published: 1000,
            summary: '',
          },
        ],
        sources: [
          { name: 'CNBC', ok: true },
          { name: 'SEC', ok: false },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<News {...props('aapl')} />);

    expect(fetchMock).toHaveBeenCalledWith(`${EDGE_URL}/news?q=Apple`);
    const request = sent.find((message) => message.type === 'news');
    if (request?.type !== 'news') throw new Error('no company news request');
    expect(request.symbol.id).toBe('AAPL');

    act(() => {
      const reply: HubMessage = {
        type: 'news',
        requestId: request.requestId,
        source: 'finnhub',
        items: [
          {
            title: 'Apple supplier deal',
            url: 'https://yahoo.test/9',
            source: 'Yahoo',
            published: 3000,
            summary: '',
          },
          {
            title: 'Duplicate story',
            url: 'https://other.test/2',
            source: 'Yahoo',
            published: 900,
            summary: '',
          },
        ],
      };
      port.onmessage?.(new MessageEvent('message', { data: reply }));
    });

    await screen.findByText('Apple supplier deal');
    const titles = screen.getAllByRole('link').map((link) => link.textContent);
    expect(titles).toEqual(['Apple supplier deal', 'Apple unveils glasses', 'Duplicate story']);
    expect(screen.getByText(/company news from finnhub on your key/)).toBeInTheDocument();
    expect(screen.getByText(/not answering: SEC/)).toBeInTheDocument();
  });

  it('says so when the edge cannot be reached and there is no company news', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<News {...props('rates')} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'News is unavailable: Failed to fetch',
    );
    expect(sent.some((message) => message.type === 'news')).toBe(false);
  });
});
