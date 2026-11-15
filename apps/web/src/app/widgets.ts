import type { IDockviewPanelProps } from 'dockview-react';
import type { FunctionComponent } from 'react';
import type { WidgetMeta } from '../widgets/types';

type WidgetView = FunctionComponent<IDockviewPanelProps>;

const metas = import.meta.glob<WidgetMeta>('../widgets/*/meta.ts', {
  eager: true,
  import: 'meta',
});
const views = import.meta.glob<WidgetView>('../widgets/*/index.tsx', {
  eager: true,
  import: 'default',
});

export interface Widget {
  meta: WidgetMeta;
  view: WidgetView;
}

/** Every widget, discovered from its folder; adding one touches no shared file. */
export const WIDGETS: readonly Widget[] = Object.entries(metas).flatMap(([path, meta]) => {
  const view = views[path.replace(/meta\.ts$/, 'index.tsx')];
  return view ? [{ meta, view }] : [];
});

/** Dock components by widget id. */
export const DOCK_COMPONENTS: Record<string, WidgetView> = Object.fromEntries(
  WIDGETS.filter((widget) => widget.meta.dock).map((widget) => [widget.meta.id, widget.view]),
);

export function widgetMeta(id: string): WidgetMeta | undefined {
  return WIDGETS.find((widget) => widget.meta.id === id)?.meta;
}
