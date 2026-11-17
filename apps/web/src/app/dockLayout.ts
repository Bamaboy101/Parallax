import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { DEFAULT_WORKSPACE, WORKSPACES, type Workspace } from '../workspaces';
import { popoutsAsFloating } from './popout';
import { panelTitle, widgetMeta } from './widgets';

/** E5: on a phone, Simple lays presets out as tabs in one full-width group. Set by DockArea. */
let tabbed = false;
export function setTabbedPresets(value: boolean): void {
  tabbed = value;
}

/**
 * Lay out a preset workspace on an empty dock. Panels for unknown widgets are skipped. With
 * `tabs`, every panel joins the first one's group as a tab (the first stays in front).
 */
export function buildWorkspace(api: DockviewApi, workspace: Workspace, tabs = false): void {
  let first: string | undefined;
  for (const panel of workspace.panels) {
    const meta = widgetMeta(panel.component);
    if (!meta) continue;
    const base = {
      id: panel.id,
      component: panel.component,
      title: panelTitle(meta, panel.params),
      params: { ...meta.defaultParams, ...panel.params },
    };
    if (tabs) {
      api.addPanel(
        first === undefined
          ? base
          : { ...base, position: { referencePanel: first, direction: 'within' }, inactive: true },
      );
      first ??= panel.id;
      continue;
    }
    const reference = panel.position && api.getPanel(panel.position.referencePanel);
    api.addPanel({
      ...base,
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
        buildWorkspace(api, workspace, tabbed);
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
 * Restore a saved layout, falling back to a preset (the default workspace unless given) when there
 * is none or it no longer loads (for example, it names a component that was removed). Panels that
 * were in their own window come back floating in this one (F9).
 */
export function restoreLayout(
  api: DockviewApi,
  saved: SerializedDockview | null,
  preset: string = DEFAULT_WORKSPACE,
): 'saved' | 'default' {
  if (saved) {
    try {
      api.fromJSON(popoutsAsFloating(saved));
      if (api.panels.length > 0) return 'saved';
    } catch {
      // Unloadable layout: fall through to the default.
    }
    api.clear();
  }
  applyPreset(api, preset);
  return 'default';
}
