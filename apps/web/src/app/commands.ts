import type { DockviewApi, IDockviewPanel } from 'dockview-react';
import type { Command } from '../command/parser';
import type { Instrument } from '../store/symbols';
import type { WidgetMeta } from '../widgets/types';
import { dockApi } from './dockApi';
import { applyPreset } from './dockLayout';
import { widgetMeta } from './widgets';

type Params = Record<string, unknown>;

const paramsOf = (panel: IDockviewPanel): Params => panel.params ?? {};

const symbolList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

/** Add a symbol to a list widget's params, keeping order and skipping duplicates. */
function addToList(panel: IDockviewPanel, meta: WidgetMeta, symbol: Instrument): void {
  const params = paramsOf(panel);
  const current = symbolList(params.symbols ?? meta.defaultParams?.symbols);
  if (!current.includes(symbol.id)) {
    panel.api.updateParameters({ ...params, symbols: [...current, symbol.id] });
  }
  panel.api.setActive();
}

/** Open a widget as a new tab beside the active panel. */
function openWidget(api: DockviewApi, widget: WidgetMeta, params: Params, title: string): void {
  const active = api.activePanel;
  api.addPanel({
    id: `${widget.id}-${crypto.randomUUID().slice(0, 8)}`,
    component: widget.id,
    title,
    params: { ...widget.defaultParams, ...params },
    ...(active ? { position: { referencePanel: active.id, direction: 'within' as const } } : {}),
  });
}

/** Carry out a command-bar command against the dock. Returns false when it could not run. */
export function runCommand(command: Command): boolean {
  const api = dockApi();
  if (!api) return false;

  switch (command.kind) {
    case 'layout':
      return applyPreset(api, command.name);

    case 'open': {
      const { widget, symbol, interval, query } = command;
      if (widget.input === 'symbols') {
        const existing = api.panels.find((panel) => panel.api.component === widget.id);
        if (existing) {
          if (symbol) addToList(existing, widget, symbol);
          else existing.api.setActive();
          return true;
        }
        const base = symbolList(widget.defaultParams?.symbols);
        const symbols = symbol && !base.includes(symbol.id) ? [...base, symbol.id] : base;
        openWidget(api, widget, { symbols }, widget.title);
        return true;
      }
      const params: Params = {
        ...(symbol ? { symbol: symbol.id } : {}),
        ...(interval ? { interval } : {}),
        ...(query ? { query } : {}),
      };
      const label = symbol?.label ?? query;
      openWidget(api, widget, params, label ? `${widget.title} · ${label}` : widget.title);
      return true;
    }

    case 'load': {
      const active = api.activePanel;
      const meta = active ? widgetMeta(active.api.component) : undefined;
      if (active && meta?.input === 'symbol') {
        active.api.updateParameters({ ...paramsOf(active), symbol: command.symbol.id });
        active.api.setTitle(`${meta.title} · ${command.symbol.label}`);
        return true;
      }
      if (active && meta?.input === 'symbols') {
        addToList(active, meta, command.symbol);
        return true;
      }
      // Nothing symbol-shaped is focused: open a chart for it.
      const chart = widgetMeta('chart');
      if (!chart) return false;
      openWidget(
        api,
        chart,
        { symbol: command.symbol.id },
        `${chart.title} · ${command.symbol.label}`,
      );
      return true;
    }
  }
}
