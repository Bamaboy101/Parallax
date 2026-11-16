import { classifyEvents, type PredictionEvent } from './classify';

/**
 * Polymarket's public Gamma API (keyless, CORS open). Each visitor's browser reads it directly;
 * nothing is relayed through the project's servers.
 */
export const GAMMA_EVENTS = 'https://gamma-api.polymarket.com/events';

/**
 * Tag queries, each the most-traded open events first. Gamma has no field selection and an event
 * carries every market's description, so limits stay small: one refresh is about 1 MB on the
 * wire. Elections carry the most markets per event, so they get the fewest.
 */
export const QUERIES: readonly { tag: string; limit: number }[] = [
  { tag: 'fed-rates', limit: 20 },
  { tag: 'Global-Rates', limit: 20 },
  { tag: 'ecb', limit: 5 },
  { tag: 'boe', limit: 5 },
  { tag: 'boj', limit: 5 },
  { tag: 'macro-indicators', limit: 20 },
  { tag: 'inflation', limit: 10 },
  { tag: 'gdp', limit: 10 },
  { tag: 'elections', limit: 12 },
  { tag: 'world-elections', limit: 12 },
  { tag: 'geopolitics', limit: 25 },
  { tag: 'tariffs', limit: 10 },
  { tag: 'oil', limit: 15 },
  { tag: 'opec', limit: 10 },
  { tag: 'government-shutdown', limit: 5 },
  { tag: 'debt-ceiling', limit: 5 },
];

/** Events with less than this traded in total are too thin to say much. */
const MIN_VOLUME_USD = 20_000;
/** At most this many events reach the panel, most traded in 24 hours first. */
const MAX_EVENTS = 120;

export const eventsUrl = (query: { tag: string; limit: number }): string =>
  `${GAMMA_EVENTS}?tag_slug=${encodeURIComponent(query.tag)}&closed=false&active=true` +
  `&limit=${String(query.limit)}&order=volume24hr&ascending=false` +
  `&volume_min=${String(MIN_VOLUME_USD)}`;

export interface LoadResult {
  events: PredictionEvent[];
  /** Why each failed query failed; all failing means nothing could be loaded. */
  errors: unknown[];
}

/** Run every query, keep the in-scope events once each, most traded first. */
export async function loadEvents(getJson: (url: string) => Promise<unknown>): Promise<LoadResult> {
  const answers = await Promise.allSettled(QUERIES.map((query) => getJson(eventsUrl(query))));
  const byId = new Map<string, PredictionEvent>();
  const errors: unknown[] = [];
  for (const answer of answers) {
    if (answer.status === 'rejected') {
      errors.push(answer.reason);
      continue;
    }
    for (const event of classifyEvents(answer.value)) byId.set(event.id, event);
  }
  const events = [...byId.values()].sort((a, b) => b.volume24h - a.volume24h).slice(0, MAX_EVENTS);
  return { events, errors };
}
