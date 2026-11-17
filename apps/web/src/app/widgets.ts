import type { IDockviewPanelProps } from 'dockview-react';
import { createElement, type FunctionComponent } from 'react';
import { plainName } from '../design/plain';
import { usePrefs } from '../store/prefs';
import { instrument } from '../store/symbols';
import type { WidgetMeta } from '../widgets/types';
import { LearnFrame } from './LearnStrip';
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

/**
 * Each dock widget runs inside its own error boundary, so one failure stays in its panel, and in
 * the learn frame that explains it when learn mode is on (F5).
 */
function contained(widget: Widget): WidgetView {
  const Contained: WidgetView = (props) =>
    createElement(LearnFrame, {
      panelId: props.api.id,
      explanation: widget.meta.learn,
      children: createElement(PanelBoundary, {
        title: widget.meta.title,
        children: createElement(widget.view, props),
      }),
    });
  Contained.displayName = `Contained(${widget.meta.id})`;
  return Contained;
}

/** Dock components by widget id. */
export const DOCK_COMPONENTS: Record<string, WidgetView> = Object.fromEntries(
  WIDGETS.filter((widget) => widget.meta.dock).map((widget) => [widget.meta.id, contained(widget)]),
);

/**
 * A panel's tab title: the widget, plus the symbol or query it shows ('Chart · ETH/USD', or
 * 'Chart · Ether' in Simple mode).
 */
export function panelTitle(meta: WidgetMeta, params: Readonly<Record<string, unknown>>): string {
  const item =
    meta.input === 'symbol' && typeof params.symbol === 'string'
      ? instrument(params.symbol)
      : undefined;
  const simple = usePrefs.getState().mode === 'simple';
  const detail = item
    ? simple
      ? plainName(item)
      : item.label
    : meta.input === 'query' && typeof params.query === 'string' && params.query !== ''
      ? params.query
      : undefined;
  return detail ? `${meta.title} · ${detail}` : meta.title;
}

export function widgetMeta(id: string): WidgetMeta | undefined {
  return WIDGETS.find((widget) => widget.meta.id === id)?.meta;
}
