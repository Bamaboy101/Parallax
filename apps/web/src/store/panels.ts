import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Freshness } from '../design/format';
import type { SourceStatus } from '../feeds/protocol';
import { useTickStore } from './ticks';

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

/**
 * Freshness of sources outside the hub, by source id: REST data such as the ECB's daily rates.
 * The store module that fetches it reports here, and badges read it like a hub status.
 */
const useRestStore = create<Record<string, Freshness>>()(() => ({}));

export function reportRestFreshness(source: string, freshness: Freshness): void {
  useRestStore.setState({ [source]: freshness });
}

/**
 * A hub status as badge freshness: live streams show their exchange-to-browser delay, a live
 * poller its interval; anything not live is offline for now (T18).
 */
function freshnessOf(status: SourceStatus): Freshness {
  if (status.state !== 'live') return { kind: 'offline' };
  if (status.pollMs !== null && !status.stale) return { kind: 'polled', everyMs: status.pollMs };
  return { kind: 'live', ageMs: status.latencyMs ?? 0, stale: status.stale };
}

/** Freshness per source: from the hub's status for feeds, as reported for REST sources. */
export function useFreshness(sources: readonly string[]): Freshness[] {
  const statuses = useTickStore(useShallow((state) => sources.map((s) => state.status[s])));
  const rest = useRestStore(useShallow((state) => sources.map((source) => state[source])));
  return sources.map((_, index) => {
    const status = statuses[index];
    return status ? freshnessOf(status) : (rest[index] ?? { kind: 'offline' });
  });
}
