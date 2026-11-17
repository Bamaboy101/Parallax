import { describe, expect, it } from 'vitest';
import type { Mover } from './movers';
import type { Outcome, PredictionEvent } from './predictions/classify';
import { biggestMoves, dailyStat, releasesForToday, topEvents } from './rundown';
import { instrument } from './symbols';

const mover = (id: string, changePct: number | undefined): Mover => {
  const item = instrument(id);
  if (!item) throw new Error(`${id} missing`);
  return { item, price: 1, changePct, tradedUsd: 0, source: 'coinbase' };
};

describe('biggestMoves', () => {
  it('ranks by the size of the move either way and skips flat or unknown changes', () => {
    const moves = biggestMoves(
      [
        mover('BTC-USD', -1.5),
        mover('ETH-USD', 0.2),
        mover('SOL-USD', 2.1),
        mover('XRP-USD', undefined),
        mover('DOGE-USD', 0),
      ],
      2,
    );
    expect(moves.map((move) => move.item.id)).toEqual(['SOL-USD', 'BTC-USD']);
  });
});

describe('dailyStat', () => {
  it('gives the latest value and its change from the previous published day', () => {
    expect(
      dailyStat([
        { date: '2026-11-12', value: 100 },
        { date: '2026-11-13', value: 102 },
      ]),
    ).toEqual({ value: 102, changePct: 2.0000000000000018, asOf: '2026-11-13' });
    expect(dailyStat([{ date: '2026-11-13', value: 90 }])?.changePct).toBeUndefined();
    expect(dailyStat(undefined)).toBeUndefined();
  });
});

const outcome = (label: string, price: number, extra: Partial<Outcome> = {}): Outcome => ({
  label,
  tokenId: label,
  price,
  dayChange: null,
  lastTrade: null,
  wideSpread: false,
  ends: null,
  ...extra,
});

const event = (id: string, volume24h: number, outcomes: Outcome[]): PredictionEvent => ({
  id,
  slug: id,
  title: id,
  theme: 'central-banks',
  region: 'us',
  endDate: null,
  volume24h,
  volume: volume24h,
  outcomes,
  assets: [],
});

describe('topEvents', () => {
  const now = Date.UTC(2026, 10, 18);

  it('takes the busiest events and the leading open outcome at its live odds', () => {
    const events = [
      event('quiet', 10, [outcome('Yes', 0.6)]),
      event('fed', 1_000, [outcome('Cut', 0.3), outcome('Hold', 0.7)]),
      event('ladder', 500, [
        outcome('November 1', 0.9, { ends: now - 1 }),
        outcome('December 31', 0.4, { ends: now + 1, dayChange: 0.1 }),
      ]),
    ];
    const top = topEvents(events, { Cut: 0.8 }, now, 2);
    // The live midpoint moved "Cut" ahead of Gamma's listed price.
    expect(top.map((entry) => [entry.event.id, entry.outcome.label, entry.odds])).toEqual([
      ['fed', 'Cut', 0.8],
      ['ladder', 'December 31', 0.4],
    ]);
    // A rung whose date has passed is not "most likely", whatever its price.
    expect(top[1]?.dayChange).toBeCloseTo(0.1);
  });
});

describe('releasesForToday', () => {
  const releases = [
    { date: '2026-11-18', id: 1, name: 'Retail Sales' },
    { date: '2026-11-18', id: 2, name: 'Industrial Production' },
    { date: '2026-11-20', id: 3, name: 'Existing Home Sales' },
  ];

  it("lists today's releases in New York", () => {
    // 15:00 UTC on 18 Nov is 10:00 in New York.
    const day = releasesForToday(releases, Date.UTC(2026, 10, 18, 15));
    expect(day).toMatchObject({ date: '2026-11-18', today: true });
    expect(day?.releases.map((release) => release.id)).toEqual([1, 2]);
  });

  it('falls forward to the next day with releases, by the New York date', () => {
    // 03:00 UTC on 19 Nov is still 18 Nov in New York; 06:00 UTC on 19 Nov is the 19th.
    expect(releasesForToday(releases, Date.UTC(2026, 10, 19, 3))?.today).toBe(true);
    expect(releasesForToday(releases, Date.UTC(2026, 10, 19, 6))).toMatchObject({
      date: '2026-11-20',
      today: false,
    });
  });
});
