import type { IDockviewHeaderActionsProps, IDockviewPanel } from 'dockview-react';
import { useCallback, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Badge } from '../design/Badge';
import type { Freshness } from '../design/format';
import type { SourceStatus } from '../feeds/protocol';
import { linkGroupOf, useLinkStore, type LinkGroup } from '../store/links';
import { usePanelSources } from '../store/panels';
import { useTickStore } from '../store/ticks';
import { retarget } from './links';
import { widgetMeta } from './widgets';

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
 * The panel's link group: click to cycle none → 1 → 2 → 3 → 4 → none. Joining a group that has
 * already picked a symbol switches the panel to it at once.
 */
function LinkDot({ panel, group }: { panel: IDockviewPanel; group: LinkGroup | undefined }) {
  const next: LinkGroup | undefined =
    group === undefined ? 1 : group === 4 ? undefined : ((group + 1) as LinkGroup);
  const label =
    group === undefined
      ? 'Not linked. Click to join link group 1'
      : `Link group ${String(group)}. Click for ${next === undefined ? 'no link' : `group ${String(next)}`}`;
  return (
    <button
      type="button"
      className="link-dot"
      data-link={group ?? 'none'}
      aria-label={label}
      title={label}
      onClick={() => {
        panel.api.updateParameters({ ...panel.params, link: next });
        const symbol = next === undefined ? undefined : useLinkStore.getState().symbols[next];
        if (symbol) retarget(panel, symbol);
      }}
    >
      {group ?? ''}
    </button>
  );
}

/**
 * Header actions for the active panel of a dock group: its link dot, and its truth badge. A panel
 * fed by several feeds shows the worst one, plus a count; the tooltip lists every feed.
 */
export function PanelBadges({ group }: IDockviewHeaderActionsProps) {
  const subscribe = useCallback(
    (notify: () => void) => {
      let params = group.activePanel?.api.onDidParametersChange(notify);
      const active = group.api.onDidActivePanelChange(() => {
        params?.dispose();
        params = group.activePanel?.api.onDidParametersChange(notify);
        notify();
      });
      return () => {
        active.dispose();
        params?.dispose();
      };
    },
    [group],
  );
  // A string snapshot, so a params change re-renders only when the link group changes.
  const snapshot = useSyncExternalStore(subscribe, () => {
    const panel = group.activePanel;
    return panel ? `${panel.id}|${String(linkGroupOf(panel.params) ?? '')}` : '';
  });
  const [panelId] = snapshot.split('|');
  const panel = group.activePanel;
  const linkable = panel !== undefined && widgetMeta(panel.api.component)?.input !== 'none';
  const sources = usePanelSources(panelId === '' ? undefined : panelId);
  const statuses = useTickStore(useShallow((state) => sources.map((s) => state.status[s])));

  const feeds = sources.map((source, index) => ({
    source,
    freshness: freshnessOf(statuses[index]),
  }));
  const worst =
    feeds.length > 0
      ? feeds.reduce((a, b) => (severity(b.freshness) > severity(a.freshness) ? b : a))
      : undefined;
  const others = feeds.length - 1;
  if (!worst && !linkable) return null;
  return (
    <div
      className="panel-badges flex h-full items-center gap-1 pr-2"
      title={feeds.map((feed) => feed.source).join(', ')}
    >
      {linkable && <LinkDot panel={panel} group={linkGroupOf(panel.params)} />}
      {worst && <Badge freshness={worst.freshness} source={worst.source} />}
      {others > 0 && (
        <span className="panel-badges-count font-mono text-label text-muted">+{others}</span>
      )}
    </div>
  );
}
