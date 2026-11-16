import type { IDockviewPanelProps } from 'dockview-react';
import { createElement, type FunctionComponent } from 'react';
import type { WidgetMeta } from '../widgets/types';
import { PanelBoundary } from './PanelBoundary';

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

/** Each dock widget runs inside its own error boundary, so one failure stays in its panel. */
function contained(widget: Widget): WidgetView {
  const Contained: WidgetView = (props) =>
    createElement(PanelBoundary, {
      title: widget.meta.title,
      children: createElement(widget.view, props),
    });
  Contained.displayName = `Contained(${widget.meta.id})`;
  return Contained;
}

/** Dock components by widget id. */
export const DOCK_COMPONENTS: Record<string, WidgetView> = Object.fromEntries(
  WIDGETS.filter((widget) => widget.meta.dock).map((widget) => [widget.meta.id, contained(widget)]),
);

export function widgetMeta(id: string): WidgetMeta | undefined {
  return WIDGETS.find((widget) => widget.meta.id === id)?.meta;
}
