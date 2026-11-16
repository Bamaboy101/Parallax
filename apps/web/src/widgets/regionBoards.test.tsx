import { render, screen, within } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubRequest } from '../feeds/protocol';
import { connectFeed, disconnectFeed } from '../store/feedClient';
import { instrument } from '../store/symbols';
import AsiaPacific from './asia-pacific';
import Europe from './europe';
import { ASIA_PACIFIC, EUROPE, LICENCE_NOTE, regionOpenNotice } from './regionBoards';

const props = { api: { id: 'board-1' }, params: {} } as unknown as IDockviewPanelProps;

describe('region boards', () => {
  it('know every pair and proxy they list', () => {
    for (const board of [EUROPE, ASIA_PACIFIC]) {
      for (const id of board.fx) expect(instrument(id)?.kind, id).toBe('fx');
      for (const row of board.groups.flatMap((group) => group.rows)) {
        if (row.proxy) expect(instrument(row.proxy)?.kind, row.proxy).toBe('equity');
      }
    }
    // Twenty indices: nineteen through a proxy, TAIEX official.
    const indices = [EUROPE, ASIA_PACIFIC]
      .flatMap((board) => board.groups.flatMap((group) => group.rows))
      .filter((row) => !['Developed Europe', 'Taiwan'].includes(row.index));
    expect(indices).toHaveLength(20);
    expect(indices.filter((row) => row.official)).toHaveLength(1);
  });

  it('points to the live currencies while the region trades and New York is closed', () => {
    // Tuesday 17 Nov 2026, 09:00 UTC: Frankfurt 10:00 and London 09:00 are open, New York 04:00.
    expect(regionOpenNotice(EUROPE, Date.parse('2026-11-17T09:00:00Z'))).toBe(
      'Frankfurt and London are open and the US is closed, so the proxies below hold their last ' +
        'US close (New York opens in 5h 30m). The currency rows above move live now.',
    );
    // 02:00 UTC: Sydney 13:00, Tokyo 11:00 and Hong Kong 10:00 trade; Mumbai opens at 03:45 UTC.
    expect(regionOpenNotice(ASIA_PACIFIC, Date.parse('2026-11-17T02:00:00Z'))).toMatch(
      /^Sydney, Tokyo and Hong Kong are open and the US is closed/,
    );
    // 15:00 UTC: New York is open, so the proxies are trading and there is nothing to say.
    expect(regionOpenNotice(EUROPE, Date.parse('2026-11-17T15:00:00Z'))).toBeNull();
    // 23:00 UTC: neither Europe nor New York trades.
    expect(regionOpenNotice(EUROPE, Date.parse('2026-11-17T23:00:00Z'))).toBeNull();
  });
});

describe('region board panels', () => {
  beforeEach(() => {
    const sent: HubRequest[] = [];
    connectFeed({ postMessage: (message) => sent.push(message), onmessage: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  });

  afterEach(() => {
    disconnectFeed();
    vi.unstubAllGlobals();
  });

  it('puts the live currency pairs first, then each index beside its labelled proxy', () => {
    render(<Europe {...props} />);
    const fx = screen.getByRole('region', { name: 'Europe currencies' });
    expect(
      within(fx)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining('EUR/USD'),
      expect.stringContaining('GBP/USD'),
      expect.stringContaining('USD/CHF'),
    ]);
    const dax = screen.getByText('DAX').closest('li');
    if (!dax) throw new Error('no DAX row');
    expect(dax).toHaveTextContent('EWG');
    expect(dax).toHaveTextContent('proxy, US hours only');
    expect(dax).toHaveTextContent(LICENCE_NOTE);
  });

  it('shows TAIEX from TWSE open data with the licence’s attribution', () => {
    render(<AsiaPacific {...props} />);
    const taiex = screen.getByText('TAIEX').closest('li');
    if (!taiex) throw new Error('no TAIEX row');
    expect(taiex).toHaveTextContent('TWSE · end of day');
    expect(taiex).not.toHaveTextContent(LICENCE_NOTE);
    expect(screen.getByText(/Open Government Data License, version 1\.0/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Government Data License' })).toHaveAttribute(
      'href',
      'https://data.gov.tw/license',
    );
  });
});
