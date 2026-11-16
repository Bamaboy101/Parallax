import { act, render, renderHook } from '@testing-library/react';
import { DockviewReact, type DockviewApi } from 'dockview-react';
import { afterEach, describe, expect, it } from 'vitest';
import { selectLinked, useLinkStore } from '../store/links';
import { useLinkFollower } from './links';
import { DOCK_COMPONENTS } from './widgets';

const stub = Object.fromEntries(Object.keys(DOCK_COMPONENTS).map((id) => [id, () => null]));

function mountDock(): DockviewApi {
  let api: DockviewApi | undefined;
  render(
    <DockviewReact
      components={stub}
      onReady={(event) => {
        api = event.api;
      }}
    />,
  );
  if (!api) throw new Error('dockview did not become ready');
  return api;
}

afterEach(() => {
  useLinkStore.setState({ symbols: {} });
});

describe('linked panels', () => {
  it('moves every panel in the group to the selected symbol, the way each takes input', () => {
    const api = mountDock();
    api.addPanel({
      id: 'chart',
      component: 'chart',
      title: 'Chart',
      params: { link: 1, interval: '1h' },
    });
    api.addPanel({ id: 'news', component: 'news', title: 'News', params: { link: 1 } });
    api.addPanel({
      id: 'list',
      component: 'watchlist',
      title: 'Watchlist',
      params: { link: 1, symbols: ['BTC-USD'] },
    });
    api.addPanel({ id: 'other', component: 'book', title: 'Order book', params: { link: 2 } });
    renderHook(() => {
      useLinkFollower(api);
    });

    act(() => {
      selectLinked(1, 'ETH-USD');
    });

    expect(api.getPanel('chart')?.params).toEqual({ link: 1, interval: '1h', symbol: 'ETH-USD' });
    expect(api.getPanel('chart')?.title).toBe('Chart · ETH/USD');
    expect(api.getPanel('news')?.params).toEqual({ link: 1, query: 'Ether' });
    // Lists keep their own symbols, and other groups do not move.
    expect(api.getPanel('list')?.params).toEqual({ link: 1, symbols: ['BTC-USD'] });
    expect(api.getPanel('other')?.params).toEqual({ link: 2 });

    act(() => {
      selectLinked(1, 'AAPL');
    });
    expect(api.getPanel('news')?.params).toEqual({ link: 1, query: 'AAPL' });
  });

  it('ignores a selection from a panel with no link group', () => {
    selectLinked(undefined, 'ETH-USD');
    expect(useLinkStore.getState().symbols).toEqual({});
  });
});
