import type { DockviewApi, SerializedDockview } from 'dockview-react';

/** Default layout until the preset workspaces arrive in T17. */
export function buildDefaultLayout(api: DockviewApi): void {
  api.addPanel({ id: 'chart', component: 'chart', title: 'Chart' });
  api.addPanel({
    id: 'watchlist',
    component: 'watchlist',
    title: 'Watchlist',
    position: { referencePanel: 'chart', direction: 'left' },
    initialWidth: 380,
  });
  api.addPanel({
    id: 'book',
    component: 'placeholder',
    title: 'Order book',
    position: { referencePanel: 'chart', direction: 'right' },
    initialWidth: 300,
  });
  api.addPanel({
    id: 'tape',
    component: 'tape',
    title: 'Trades',
    position: { referencePanel: 'book', direction: 'below' },
  });
}

/**
 * Restore a saved layout, falling back to the default when there is none or it no longer loads
 * (for example, it names a component that was removed).
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
  buildDefaultLayout(api);
  return 'default';
}
