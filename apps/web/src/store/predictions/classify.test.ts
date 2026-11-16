import { describe, expect, it } from 'vitest';
import {
  classifyEvent,
  classifyEvents,
  dayChangeOf,
  oddsOf,
  openOutcomes,
  type Outcome,
} from './classify';
import fixture from './fixtures/gamma-events.json';
import { loadEvents, QUERIES } from './load';

/** Real Gamma events recorded on 17 Nov 2026, trimmed to the fields M1 reads. */
const events = fixture as unknown[];
const byTitle = (title: string) => {
  const raw = events.find((event) => (event as { title: string }).title === title);
  if (raw === undefined) throw new Error(`fixture has no "${title}"`);
  return classifyEvent(raw);
};

describe('prediction-market curation', () => {
  it('keeps central-bank decisions for the six banks only, each with its region and assets', () => {
    const fed = byTitle('Fed Decision in December?');
    expect(fed).toMatchObject({ theme: 'central-banks', region: 'us' });
    expect(fed?.assets).toEqual([
      { kind: 'yield', series: 'DGS2' },
      { kind: 'instrument', id: 'PAXG-USD' },
      { kind: 'instrument', id: 'UUP' },
    ]);
    expect(byTitle('Bank of England decision in December?')).toMatchObject({ region: 'uk' });
    expect(byTitle('Bank of Japan Decision in December?')?.assets).toContainEqual({
      kind: 'instrument',
      id: 'USD-JPY',
    });
    // A rate decision outside the six (Bank of Canada) is out of scope.
    expect(byTitle('Bank of Canada Decision in December?')).toBeNull();
  });

  it('files events under the theme that moves markets', () => {
    expect(byTitle('JOLTS Job Openings: October 2026')).toMatchObject({
      theme: 'macro-data',
      region: 'us',
    });
    expect(byTitle('Next French Presidential Election')).toMatchObject({
      theme: 'elections',
      region: 'europe',
    });
    expect(byTitle('Will China invade Taiwan by end of 2026?')).toMatchObject({
      theme: 'geopolitics',
      region: 'asia-pacific',
    });
    expect(byTitle('Strait of Hormuz traffic returns to normal by December 31?')).toMatchObject({
      theme: 'trade-energy',
      region: 'middle-east',
    });
    expect(byTitle('Government shutdown by...?')).toMatchObject({ theme: 'fiscal', region: 'us' });
    expect(byTitle('US-Canada diplomatic agreement to lower tariffs by...?')).toMatchObject({
      theme: 'trade-energy',
      region: 'americas',
    });
  });

  it('drops sports, entertainment, crypto-price bets, price targets and novelty markets', () => {
    for (const title of [
      'Elon Musk # tweets November 10 - November 17, 2026?',
      'What will WTI Crude Oil (WTI) hit in November 2026?',
      'How high will 10-year Treasury yield go before 2027?',
      'Will the US confirm that aliens exist by...?',
      'Largest Company end of December 2026?',
      'How long will Xi and Takaichi shake hands?',
      'Pete Hegseth out as Secretary of Defense by December 31?',
      'Taipei Mayor Election Winner',
      'Ljubljana Mayoral Election Winner',
    ]) {
      expect(byTitle(title), title).toBeNull();
    }
  });

  it('shows the most likely outcome first, but reads a "by…?" ladder in date order', () => {
    const fed = byTitle('Fed Decision in December?');
    const prices = fed?.outcomes.map((outcome) => outcome.price) ?? [];
    expect(prices).toEqual([...prices].sort((a, b) => b - a));

    const ladder = byTitle('Israel x Iran ceasefire continues through...?');
    if (!ladder) throw new Error('ladder event was dropped');
    const ends = ladder.outcomes.map((outcome) => outcome.ends ?? 0);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
    // A rung whose date has passed is waiting for resolution, so it is not shown as open.
    const now = Date.parse('2026-11-17T12:00:00Z');
    const open = openOutcomes(ladder, now);
    expect(open.every((outcome) => (outcome.ends ?? 0) > now)).toBe(true);
    expect(open.length).toBeLessThan(ladder.outcomes.length);
  });

  it('skips anything that is not a Gamma event', () => {
    expect(classifyEvents({ error: 'nope' })).toEqual([]);
    expect(classifyEvents([null, 1, { title: 'x' }])).toEqual([]);
  });
});

describe('odds', () => {
  const outcome = (patch: Partial<Outcome>): Outcome => ({
    label: 'Yes',
    tokenId: 't',
    price: 0.6,
    dayChange: 0.05,
    lastTrade: 0.4,
    wideSpread: false,
    ends: null,
    ...patch,
  });

  it('uses the live midpoint, or the last trade when the spread is wide (Polymarket’s rule)', () => {
    expect(oddsOf(outcome({}), 0.62)).toBe(0.62);
    expect(oddsOf(outcome({}), undefined)).toBe(0.6);
    expect(oddsOf(outcome({ wideSpread: true }), 0.62)).toBe(0.4);
  });

  it('measures the 24 h change from the price a day ago, so a newer midpoint moves it', () => {
    // Gamma: 0.60 now, +5 points in 24 h, so 0.55 a day ago; the live midpoint is 0.62.
    expect(dayChangeOf(outcome({}), 0.62)).toBeCloseTo(0.07);
    expect(dayChangeOf(outcome({ dayChange: null }), 0.62)).toBeNull();
  });
});

describe('loading', () => {
  it('merges every tag query once per event, most traded first, and survives a failed query', async () => {
    let call = 0;
    const result = await loadEvents(() => {
      call += 1;
      if (call === 2) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(events);
    });
    expect(call).toBe(QUERIES.length);
    expect(result.errors).toHaveLength(1);
    const ids = result.events.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    const volumes = result.events.map((event) => event.volume24h);
    expect(volumes).toEqual([...volumes].sort((a, b) => b - a));
  });
});
