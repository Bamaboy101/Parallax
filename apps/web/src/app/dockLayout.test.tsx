import { render } from '@testing-library/react';
import { DockviewReact, type DockviewApi, type SerializedDockview } from 'dockview-react';
import { describe, expect, it } from 'vitest';
import { restoreLayout } from './dockLayout';

const DEFAULT_IDS = ['book', 'chart', 'tape', 'watchlist'];

function mountDock(): DockviewApi {
  let api: DockviewApi | undefined;
  render(
    <DockviewReact
      components={{ placeholder: () => null, watchlist: () => null, tape: () => null }}
      onReady={(event) => {
        api = event.api;
      }}
    />,
  );
  if (!api) throw new Error('dockview did not become ready');
  return api;
}

const panelIds = (api: DockviewApi) => api.panels.map((panel) => panel.id).sort();

describe('restoreLayout', () => {
  it('builds the four default panels when nothing is saved', () => {
    const api = mountDock();
    expect(restoreLayout(api, null)).toBe('default');
    expect(panelIds(api)).toEqual(DEFAULT_IDS);
  });

  it('restores a saved layout instead of the default', () => {
    const api = mountDock();
    restoreLayout(api, null);
    api.getPanel('tape')?.api.close();
    const saved = api.toJSON();
    api.clear();

    expect(restoreLayout(api, saved)).toBe('saved');
    expect(panelIds(api)).toEqual(['book', 'chart', 'watchlist']);
  });

  it('falls back to the default when the saved layout names a removed component', () => {
    const api = mountDock();
    restoreLayout(api, null);
    const saved = api.toJSON();
    for (const panel of Object.values(saved.panels)) panel.contentComponent = 'removed-widget';
    api.clear();

    expect(restoreLayout(api, saved)).toBe('default');
    expect(panelIds(api)).toEqual(DEFAULT_IDS);
  });

  it('falls back to the default when the saved layout is malformed', () => {
    const api = mountDock();
    const corrupt = { grid: null, panels: {} } as unknown as SerializedDockview;

    expect(restoreLayout(api, corrupt)).toBe('default');
    expect(panelIds(api)).toEqual(DEFAULT_IDS);
  });
});
