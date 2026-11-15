import type { IDockviewHeaderActionsProps } from 'dockview-react';
import { useCallback, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Badge } from '../design/Badge';
import type { Freshness } from '../design/format';
import type { SourceStatus } from '../feeds/protocol';
import { usePanelSources } from '../store/panels';
import { useTickStore } from '../store/ticks';

/** Live feeds show their exchange-to-browser delay; anything not live is offline for now (T18). */
function freshnessOf(status: SourceStatus | undefined): Freshness {
  if (status?.state === 'live') {
    return { kind: 'live', ageMs: status.latencyMs ?? 0, stale: status.stale };
  }
  return { kind: 'offline' };
}

/** Higher is worse: offline, then stale, then the slowest live feed. */
function severity(freshness: Freshness): number {
  if (freshness.kind !== 'live') return Number.MAX_SAFE_INTEGER;
  return freshness.stale ? Number.MAX_SAFE_INTEGER / 2 : freshness.ageMs;
}

/**
 * Truth badge for the active panel of a dock group. A panel fed by several feeds shows the worst
 * one, plus a count; the tooltip lists every feed.
 */
export function PanelBadges({ group }: IDockviewHeaderActionsProps) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = group.api.onDidActivePanelChange(notify);
      return () => {
        subscription.dispose();
      };
    },
    [group],
  );
  const panelId = useSyncExternalStore(subscribe, () => group.activePanel?.id);
  const sources = usePanelSources(panelId);
  const statuses = useTickStore(useShallow((state) => sources.map((s) => state.status[s])));
  if (sources.length === 0) return null;

  const feeds = sources.map((source, index) => ({
    source,
    freshness: freshnessOf(statuses[index]),
  }));
  const worst = feeds.reduce((a, b) => (severity(b.freshness) > severity(a.freshness) ? b : a));
  const others = feeds.length - 1;
  return (
    <div
      className="panel-badges flex h-full items-center gap-1 pr-2"
      title={feeds.map((feed) => feed.source).join(', ')}
    >
      <Badge freshness={worst.freshness} source={worst.source} />
      {others > 0 && (
        <span className="panel-badges-count font-mono text-label text-muted">+{others}</span>
      )}
    </div>
  );
}
