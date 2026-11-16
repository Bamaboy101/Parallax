import { render } from '@testing-library/react';
import { DockviewReact, type DockviewApi } from 'dockview-react';
import { afterEach, describe, expect, it } from 'vitest';
import { instrument, type Instrument } from '../store/symbols';
import { runCommand } from './commands';
import { setDockApi } from './dockApi';
import { DOCK_COMPONENTS, widgetMeta } from './widgets';

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
  setDockApi(api);
  return api;
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture');
  return value;
}

const ETH: Instrument = must(instrument('ETH-USD'));
const SOL: Instrument = must(instrument('SOL-USD'));

afterEach(() => {
  setDockApi(null);
});

describe('runCommand', () => {
  it('retargets the active symbol panel', () => {
    const api = mountDock();
    api.addPanel({ id: 'c', component: 'chart', title: 'Chart', params: { interval: '1h' } });
    expect(runCommand({ kind: 'load', symbol: ETH })).toBe(true);
    const panel = api.getPanel('c');
    expect(panel?.params).toEqual({ interval: '1h', symbol: 'ETH-USD' });
    expect(panel?.title).toBe('Chart · ETH/USD');
  });

  it('adds to the open watchlist instead of opening another', () => {
    const api = mountDock();
    api.addPanel({
      id: 'w',
      component: 'watchlist',
      title: 'Watchlist',
      params: { symbols: ['BTC-USD'] },
    });
    const watchlist = must(widgetMeta('watchlist'));
    runCommand({ kind: 'open', widget: watchlist, symbol: SOL });
    runCommand({ kind: 'open', widget: watchlist, symbol: SOL });
    expect(api.panels).toHaveLength(1);
    expect(api.getPanel('w')?.params).toEqual({ symbols: ['BTC-USD', 'SOL-USD'] });
  });

  it('opens a new tab with symbol and interval', () => {
    const api = mountDock();
    api.addPanel({ id: 'c', component: 'chart', title: 'Chart' });
    runCommand({ kind: 'open', widget: must(widgetMeta('chart')), symbol: ETH, interval: '4h' });
    const opened = api.panels.find((panel) => panel.id !== 'c');
    expect(opened?.params).toEqual({ symbol: 'ETH-USD', interval: '4h' });
    expect(opened?.group).toBe(api.getPanel('c')?.group);
  });

  it('opens a chart when nothing symbol-shaped is focused', () => {
    const api = mountDock();
    runCommand({ kind: 'load', symbol: ETH });
    expect(api.panels.map((panel) => [panel.api.component, panel.params])).toEqual([
      ['chart', { symbol: 'ETH-USD' }],
    ]);
  });

  it('focuses the open settings panel instead of opening another', () => {
    const api = mountDock();
    const settings = must(widgetMeta('settings'));
    runCommand({ kind: 'open', widget: settings });
    api.addPanel({ id: 'c', component: 'chart', title: 'Chart' });
    runCommand({ kind: 'open', widget: settings });
    expect(api.panels.map((panel) => panel.api.component).sort()).toEqual(['chart', 'settings']);
    expect(api.activePanel?.api.component).toBe('settings');
  });

  it('switches to a workspace preset, replacing the panels', () => {
    const api = mountDock();
    api.addPanel({ id: 'x', component: 'tape', title: 'Trades' });
    expect(runCommand({ kind: 'layout', name: 'crypto' })).toBe(true);
    expect(api.panels.map((panel) => panel.id).sort()).toEqual([
      'book',
      'chart',
      'constellation',
      'derivs',
      'tape',
      'watchlist',
    ]);
    expect(runCommand({ kind: 'layout', name: 'nope' })).toBe(false);
  });
});
