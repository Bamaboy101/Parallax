import { render } from '@testing-library/react';
import { DockviewReact, type DockviewApi, type SerializedDockview } from 'dockview-react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE, WORKSPACES } from '../workspaces';
import { applyPreset, restoreLayout, setTabbedPresets } from './dockLayout';
import { DOCK_COMPONENTS } from './widgets';

const stub = Object.fromEntries(Object.keys(DOCK_COMPONENTS).map((id) => [id, () => null]));
const DEFAULT_IDS = (
  WORKSPACES.find((workspace) => workspace.id === DEFAULT_WORKSPACE)?.panels ?? []
)
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
  it('opens Mission Control when nothing is saved', () => {
    const api = mountDock();
    expect(DEFAULT_WORKSPACE).toBe('mission-control');
    expect(restoreLayout(api, null)).toBe('default');
    expect(panelIds(api)).toEqual(DEFAULT_IDS);
    expect(api.getPanel('constellation')?.group.activePanel?.id).toBe('constellation');
  });

  it('restores a saved layout instead of the default', () => {
    const api = mountDock();
    restoreLayout(api, null);
    api.getPanel('sessions')?.api.close();
    const saved = api.toJSON();
    api.clear();

    expect(restoreLayout(api, saved)).toBe('saved');
    expect(panelIds(api)).toEqual(DEFAULT_IDS.filter((id) => id !== 'sessions'));
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

describe('workspace presets', () => {
  it('ships Mission Control first, then Overview, Crypto, Equities, Macro, the regions and Simple', () => {
    expect(WORKSPACES.map((workspace) => workspace.id)).toEqual([
      'mission-control',
      'overview',
      'crypto',
      'equities',
      'macro',
      'europe',
      'asia-pacific',
      'simple',
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

  it('lays a preset out as tabs in one group on a phone, the first panel in front', () => {
    const api = mountDock();
    setTabbedPresets(true);
    try {
      applyPreset(api, 'simple');
    } finally {
      setTabbedPresets(false);
    }
    const simple = WORKSPACES.find((workspace) => workspace.id === 'simple');
    expect(api.groups).toHaveLength(1);
    expect(api.groups[0]?.panels.map((panel) => panel.id)).toEqual(
      simple?.panels.map((panel) => panel.id),
    );
    expect(api.activePanel?.id).toBe(simple?.panels[0]?.id);
  });
});
