import { useShallow } from 'zustand/react/shallow';
import type { SourceStatus } from '../feeds/protocol';
import { routeOrder } from '../feeds/router';
import type { SymbolRef } from '../feeds/types';
import { useKeyVault } from './keys';
import { useTickStore } from './ticks';

/**
 * Where a symbol's live data stands, from the hub's status and the user's keys. Widgets show
 * data when they have it; when they do not, this says why, so an empty cell is never a mystery.
 */
export type Availability =
  /** The hub has not reported yet (the first second after load). */
  | { kind: 'starting' }
  /** A feed is assigned and connecting, or live but this symbol has not printed yet. */
  | { kind: 'connecting'; source: string }
  | { kind: 'live'; source: string }
  /**
   * Every feed for it needs a key and none is stored. `keys`: vault ids, comma-separated
   * ('alpaca,finnhub'); a string, so a re-render happens only when it changes.
   */
  | { kind: 'no-key'; keys: string }
  /** The only feeds for it rejected the stored key. */
  | { kind: 'key-rejected'; keys: string }
  /** Every usable feed is full (the free plan's symbol cap). */
  | { kind: 'capped'; source: string; limit: number }
  | { kind: 'rate-limited'; source: string; retryAt: number | null }
  /** Its feeds are reconnecting or resting after failures. */
  | { kind: 'offline'; retryAt: number | null }
  /** No feed carries this symbol at all. */
  | { kind: 'unsupported' };

const unique = (values: string[]) => [...new Set(values)].join(',');

/** Pure: the availability of `symbol` given every source's status and the stored keys. */
export function availabilityOf(
  symbol: SymbolRef,
  statuses: Readonly<Record<string, SourceStatus>>,
  keys: Readonly<Record<string, string>>,
): Availability {
  const order = routeOrder(symbol);
  if (order.length === 0) return { kind: 'unsupported' };
  const candidates = order.flatMap((id) => {
    const status = statuses[id];
    return status ? [status] : [];
  });
  if (candidates.length === 0) return { kind: 'starting' };

  const missingKey = (status: SourceStatus) =>
    status.key !== null && keys[status.key] === undefined;
  // The hub parks a subscription on its first feed even when no feed can run; such a feed is
  // not serving it, so the key question below decides.
  const serving = candidates.find(
    (status) =>
      status.serving.includes(symbol.id) &&
      !missingKey(status) &&
      status.state !== 'no-key' &&
      status.state !== 'auth-failed',
  );
  if (serving) {
    if (serving.rateLimited) {
      return { kind: 'rate-limited', source: serving.source, retryAt: serving.retryAt };
    }
    switch (serving.state) {
      case 'live':
        return { kind: 'live', source: serving.source };
      case 'reconnecting':
      case 'down':
        return { kind: 'offline', retryAt: serving.retryAt };
      default:
        return { kind: 'connecting', source: serving.source };
    }
  }

  const full = candidates.find((status) => status.waiting.includes(symbol.id));
  if (full) return { kind: 'capped', source: full.source, limit: full.symbolLimit ?? 0 };

  const usable = candidates.filter(
    (status) => !missingKey(status) && status.state !== 'auth-failed' && status.state !== 'down',
  );
  // A usable feed exists: the hub assigns it on its next status (within a second).
  if (usable.length > 0) return { kind: 'connecting', source: usable[0]?.source ?? '' };

  if (candidates.every(missingKey)) {
    return { kind: 'no-key', keys: unique(candidates.flatMap((s) => (s.key ? [s.key] : []))) };
  }
  const rejected = candidates.filter((status) => status.state === 'auth-failed');
  if (rejected.length > 0 && candidates.every((s) => missingKey(s) || s.state === 'auth-failed')) {
    return { kind: 'key-rejected', keys: unique(rejected.flatMap((s) => (s.key ? [s.key] : []))) };
  }
  const limited = candidates.find((status) => status.rateLimited);
  if (limited) return { kind: 'rate-limited', source: limited.source, retryAt: limited.retryAt };
  const retries = candidates.flatMap((status) => (status.retryAt === null ? [] : [status.retryAt]));
  return { kind: 'offline', retryAt: retries.length > 0 ? Math.min(...retries) : null };
}

/**
 * A symbol's availability. Re-renders only when its fields change (the status object itself is
 * replaced every second).
 */
export function useAvailability(symbol: SymbolRef): Availability {
  const keys = useKeyVault((state) => state.keys);
  return useTickStore(useShallow((state) => availabilityOf(symbol, state.status, keys)));
}

/**
 * The one availability shared by every symbol in a list, or null when they differ or any is live
 * or connecting. A board shows this once instead of the same reason on every row.
 */
export function useSharedAvailability(symbols: readonly SymbolRef[]): Availability | null {
  const keys = useKeyVault((state) => state.keys);
  return useTickStore(
    useShallow((state): Availability | null => {
      let shared: Availability | null = null;
      for (const symbol of symbols) {
        const availability = availabilityOf(symbol, state.status, keys);
        if (availability.kind === 'live' || availability.kind === 'connecting') return null;
        if (shared === null) shared = availability;
        else if (shared.kind !== availability.kind) return null;
      }
      return shared;
    }),
  );
}
