import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { DEFAULT_WORKSPACE, WORKSPACES, type Workspace } from '../workspaces';
import { panelTitle, widgetMeta } from './widgets';

/** Lay out a preset workspace on an empty dock. Panels for unknown widgets are skipped. */
export function buildWorkspace(api: DockviewApi, workspace: Workspace): void {
  for (const panel of workspace.panels) {
    const meta = widgetMeta(panel.component);
    if (!meta) continue;
    const reference = panel.position && api.getPanel(panel.position.referencePanel);
    api.addPanel({
      id: panel.id,
      component: panel.component,
      title: panelTitle(meta, panel.params),
      params: { ...meta.defaultParams, ...panel.params },
      ...(reference && panel.position
        ? { position: { referencePanel: reference.id, direction: panel.position.direction } }
        : {}),
      ...(panel.width === undefined ? {} : { initialWidth: panel.width }),
      ...(panel.height === undefined ? {} : { initialHeight: panel.height }),
      ...(panel.inactive === true ? { inactive: true } : {}),
    });
  }
}

/** Layouts the command bar and the workspace menu can switch to, by id. */
export const LAYOUT_PRESETS: Readonly<Record<string, (api: DockviewApi) => void>> =
  Object.fromEntries(
    WORKSPACES.map((workspace) => [
      workspace.id,
      (api: DockviewApi) => {
        buildWorkspace(api, workspace);
      },
    ]),
  );

export function applyPreset(api: DockviewApi, name: string): boolean {
  const build = LAYOUT_PRESETS[name];
  if (!build) return false;
  api.clear();
  build(api);
  return true;
}

/**
 * Restore a saved layout, falling back to the default workspace when there is none or it no longer
 * loads (for example, it names a component that was removed).
 */
export function restoreLayout(
  api: DockviewApi,
  saved: SerializedDockview | null,
): 'saved' | 'default' {
  if (saved) {
    try {
      api.fromJSON(saved);
      if (api.panels.length > 0) return 'saved';
    } catch {
      // Unloadable layout: fall through to the default.
    }
    api.clear();
  }
  applyPreset(api, DEFAULT_WORKSPACE);
  return 'default';
}
