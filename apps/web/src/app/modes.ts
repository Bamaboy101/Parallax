import type { Mode } from '../store/prefs';
import type { WidgetMeta } from '../widgets/types';
import { WORKSPACES, type Workspace } from '../workspaces';
import { widgetMeta } from './widgets';

/** E2: the widgets a mode offers. Simple leaves out the traders' panels (`meta.pro`). */
export function widgetsFor(mode: Mode, widgets: readonly WidgetMeta[]): readonly WidgetMeta[] {
  return mode === 'pro' ? widgets : widgets.filter((widget) => widget.pro !== true);
}

/** The presets a mode offers: in Simple, only those made entirely of Simple panels. */
export function presetsFor(mode: Mode): readonly Workspace[] {
  if (mode === 'pro') return WORKSPACES;
  return WORKSPACES.filter((workspace) =>
    workspace.panels.every((panel) => widgetMeta(panel.component)?.pro !== true),
  );
}
