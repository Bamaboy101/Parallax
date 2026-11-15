import { INSTRUMENTS, type Instrument } from '../store/symbols';

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** True when every character of `needle` appears in `haystack`, in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/**
 * Score one instrument against a query; 0 means no match. Exact base and pair matches rank
 * first, then prefixes, then name matches, then in-order fuzzy matches. USD pairs win ties, so
 * "btc" lands on BTC/USD before BTC/USDT.
 */
function score(item: Instrument, query: string): number {
  const pair = squash(item.base + item.quote);
  const base = item.base.toLowerCase();
  const name = squash(item.name);
  let points = 0;
  if (pair === query) points = 100;
  else if (base === query) points = 90;
  else if (pair.startsWith(query)) points = 70;
  else if (name.startsWith(query)) points = 60;
  else if (name.includes(query) || pair.includes(query)) points = 40;
  else if (isSubsequence(query, pair)) points = 20;
  if (points === 0) return 0;
  if (item.quote === 'USD') points += 2;
  if (item.kind === 'crypto') points += 1;
  return points;
}

/** Instruments matching free text such as "btc", "eth usdt", "EUR/USD" or "gold". */
export function searchInstruments(text: string, limit = 6): Instrument[] {
  const query = squash(text);
  if (query === '') return [];
  return INSTRUMENTS.map((item) => ({ item, points: score(item, query) }))
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit)
    .map((entry) => entry.item);
}
