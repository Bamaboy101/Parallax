import { render } from '@testing-library/react';
import { DockviewReact, type DockviewApi, type SerializedDockview } from 'dockview-react';
import { describe, expect, it } from 'vitest';
import { WORKSPACES } from '../workspaces';
import { applyPreset, restoreLayout } from './dockLayout';
import { DOCK_COMPONENTS } from './widgets';

const stub = Object.fromEntries(Object.keys(DOCK_COMPONENTS).map((id) => [id, () => null]));
const OVERVIEW_IDS = (WORKSPACES.find((workspace) => workspace.id === 'overview')?.panels ?? [])
  .map((panel) => panel.id)
  .sort();

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

const panelIds = (api: DockviewApi) => api.panels.map((panel) => panel.id).sort();

describe('restoreLayout', () => {
  it('opens the Overview workspace when nothing is saved', () => {
    const api = mountDock();
    expect(restoreLayout(api, null)).toBe('default');
    expect(panelIds(api)).toEqual(OVERVIEW_IDS);
    // World markets waits as a background tab; a first visit, with no key, sees the watchlist.
    expect(api.getPanel('markets')?.group.activePanel?.id).toBe('watchlist');
  });

  it('restores a saved layout instead of the default', () => {
    const api = mountDock();
    restoreLayout(api, null);
    api.getPanel('sessions')?.api.close();
    const saved = api.toJSON();
    api.clear();

    expect(restoreLayout(api, saved)).toBe('saved');
    expect(panelIds(api)).toEqual(OVERVIEW_IDS.filter((id) => id !== 'sessions'));
  });

  it('falls back to the default when the saved layout names a removed component', () => {
    const api = mountDock();
    restoreLayout(api, null);
    const saved = api.toJSON();
    for (const panel of Object.values(saved.panels)) panel.contentComponent = 'removed-widget';
    api.clear();

    expect(restoreLayout(api, saved)).toBe('default');
    expect(panelIds(api)).toEqual(OVERVIEW_IDS);
  });

  it('falls back to the default when the saved layout is malformed', () => {
    const api = mountDock();
    const corrupt = { grid: null, panels: {} } as unknown as SerializedDockview;

    expect(restoreLayout(api, corrupt)).toBe('default');
    expect(panelIds(api)).toEqual(OVERVIEW_IDS);
  });
});

describe('workspace presets', () => {
  it('ships Overview, Crypto, Equities and Macro, in that order', () => {
    expect(WORKSPACES.map((workspace) => workspace.id)).toEqual([
      'overview',
      'crypto',
      'equities',
      'macro',
    ]);
  });

  it.each(WORKSPACES.map((workspace) => [workspace.id, workspace] as const))(
    'builds every panel of %s with its symbol in the title and its link group',
    (_, workspace) => {
      const api = mountDock();
      expect(applyPreset(api, workspace.id)).toBe(true);
      expect(panelIds(api)).toEqual(workspace.panels.map((panel) => panel.id).sort());
      for (const panel of workspace.panels) {
        const built = api.getPanel(panel.id);
        expect(built?.params).toMatchObject(panel.params);
        if (typeof panel.params.symbol === 'string') {
          expect(built?.title).toContain(' · ');
        }
      }
    },
  );

  it('titles panels from their params', () => {
    const api = mountDock();
    applyPreset(api, 'macro');
    expect(api.getPanel('chart')?.title).toBe('Chart · EUR/USD');
    expect(api.getPanel('news')?.title).toBe('News · Fed');
    expect(api.getPanel('macro')?.title).toBe('Macro');
  });
});
