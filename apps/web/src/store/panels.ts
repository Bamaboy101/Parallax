import { useEffect } from 'react';
import { create } from 'zustand';

const EMPTY: readonly string[] = [];

/** Which feeds each dock panel is showing, so its header can carry the matching truth badges. */
const usePanelStore = create<{ sources: Record<string, readonly string[]> }>()(() => ({
  sources: {},
}));

/** Called by a widget: report the feeds behind what it shows. */
export function useReportSources(panelId: string, sources: readonly string[]): void {
  const key = [...new Set(sources)].sort().join(',');
  useEffect(() => {
    const list = key === '' ? EMPTY : key.split(',');
    usePanelStore.setState((state) => ({ sources: { ...state.sources, [panelId]: list } }));
    return () => {
      usePanelStore.setState((state) => ({
        sources: Object.fromEntries(Object.entries(state.sources).filter(([id]) => id !== panelId)),
      }));
    };
  }, [panelId, key]);
}

/** Called by a panel header: the feeds behind a panel. */
export function usePanelSources(panelId: string | undefined): readonly string[] {
  return usePanelStore((state) =>
    panelId === undefined ? EMPTY : (state.sources[panelId] ?? EMPTY),
  );
}
