import type { DockviewApi, IDockviewPanel } from 'dockview-react';
import { useEffect } from 'react';
import { linkGroupOf, useLinkStore, type LinkGroup } from '../store/links';
import { instrument } from '../store/symbols';
import { panelTitle, widgetMeta } from './widgets';

/**
 * Point one panel at a symbol, the way its widget takes input: a symbol widget shows it, a query
 * widget (News) searches for it. List widgets and input-less widgets are left alone.
 */
export function retarget(panel: IDockviewPanel, symbolId: string): void {
  const meta = widgetMeta(panel.api.component);
  const item = instrument(symbolId);
  if (!meta || !item) return;
  const params = panel.params ?? {};
  if (meta.input === 'symbol' && params.symbol !== item.id) {
    const next = { ...params, symbol: item.id };
    panel.api.updateParameters(next);
    panel.api.setTitle(panelTitle(meta, next));
  } else if (meta.input === 'query') {
    // Stocks search by ticker (News adds the company name); others by their name.
    const query = item.kind === 'equity' ? item.id : (item.name.split(' ')[0] ?? item.id);
    if (params.query === query) return;
    const next = { ...params, query };
    panel.api.updateParameters(next);
    panel.api.setTitle(panelTitle(meta, next));
  }
}

/** Every panel in a link group follows the symbol the group last selected. */
export function useLinkFollower(api: DockviewApi | null): void {
  useEffect(() => {
    if (!api) return;
    return useLinkStore.subscribe((state, previous) => {
      for (const [key, symbolId] of Object.entries(state.symbols)) {
        const group = Number(key) as LinkGroup;
        if (previous.symbols[group] === symbolId) continue;
        for (const panel of api.panels) {
          if (linkGroupOf(panel.params) === group) retarget(panel, symbolId);
        }
      }
    });
  }, [api]);
}
