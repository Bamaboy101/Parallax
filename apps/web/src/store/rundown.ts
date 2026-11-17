import type { Release } from './calendar';
import type { Observation } from './macro';
import type { Mover } from './movers';
import {
  dayChangeOf,
  oddsOf,
  openOutcomes,
  type Outcome,
  type PredictionEvent,
} from './predictions/classify';

/**
 * E1 Rundown: what the home page shows, decided here so the page and the written brief (E4) read
 * the same figures. Everything in it works without a key; stock-fund rows fill in with one.
 */

export interface RegionPlan {
  id: string;
  title: string;
  /** Exchange sessions (store/sessions.ts ids), in the order shown. */
  markets: readonly string[];
  /** US-listed funds that track the region's stocks, with what each stands for in plain words. */
  funds: readonly (readonly [id: string, market: string])[];
  /** Currencies against the dollar (Kraken spot), live without a key. */
  currencies: readonly string[];
  /** Taiwan's official daily index close (TWSE open data), the one keyless index level. */
  taiex?: boolean;
}

export const REGIONS: readonly RegionPlan[] = [
  {
    id: 'americas',
    title: 'Americas',
    markets: ['new-york'],
    funds: [
      ['SPY', 'US stocks (S&P 500)'],
      ['QQQ', 'US tech (Nasdaq-100)'],
    ],
    currencies: ['USD-CAD'],
  },
  {
    id: 'europe',
    title: 'Europe',
    markets: ['london', 'frankfurt'],
    funds: [
      ['FEZ', 'Euro area stocks (Euro Stoxx 50)'],
      ['EWU', 'UK stocks'],
    ],
    currencies: ['EUR-USD', 'GBP-USD'],
  },
  {
    id: 'asia-pacific',
    title: 'Asia-Pacific',
    markets: ['tokyo', 'hong-kong', 'sydney'],
    funds: [
      ['EWJ', 'Japan stocks'],
      ['FXI', 'China large companies'],
    ],
    currencies: ['USD-JPY', 'AUD-USD'],
    taiex: true,
  },
];

export const CRYPTO_IDS: readonly string[] = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
/** More coins streamed so the biggest moves have a fair field to pick from. */
const MORE_CRYPTO: readonly string[] = ['XRP-USD', 'DOGE-USD', 'ADA-USD', 'AVAX-USD', 'LINK-USD'];
export const GOLD_ID = 'PAXG-USD';
/** The Fed's broad trade-weighted dollar index and US crude (WTI), daily, through FRED. */
export const DOLLAR_SERIES = 'DTWEXBGS';
export const OIL_SERIES = 'DCOILWTICO';

/** Every symbol the Rundown streams. */
export const RUNDOWN_IDS: readonly string[] = [
  ...CRYPTO_IDS,
  ...MORE_CRYPTO,
  GOLD_ID,
  ...REGIONS.flatMap((region) => [...region.currencies, ...region.funds.map(([id]) => id)]),
];

export const TOP_MOVES = 5;
export const TOP_EVENTS = 3;

/** The largest moves either way, by size of the percent change. */
export function biggestMoves(universe: readonly Mover[], count = TOP_MOVES): Mover[] {
  return universe
    .filter((mover) => mover.changePct !== undefined && mover.changePct !== 0)
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
    .slice(0, count);
}

export interface DailyStat {
  value: number;
  /** Percent change from the previous published day, when there is one. */
  changePct: number | undefined;
  /** 'YYYY-MM-DD' of the latest value. */
  asOf: string;
}

/** The latest daily value and its change from the day before. */
export function dailyStat(observations: readonly Observation[] | undefined): DailyStat | undefined {
  const values = (observations ?? []).filter((point) => Number.isFinite(point.value));
  const latest = values.at(-1);
  if (!latest) return undefined;
  const previous = values.at(-2);
  return {
    value: latest.value,
    changePct:
      previous && previous.value !== 0 ? (latest.value / previous.value - 1) * 100 : undefined,
    asOf: latest.date,
  };
}

export interface TopEvent {
  event: PredictionEvent;
  /** The most likely open outcome, and its market odds now (0 to 1). */
  outcome: Outcome;
  odds: number;
  /** Change in the odds over 24 hours, in points of probability (0.05 = 5 points). */
  dayChange: number | null;
}

/** The market-moving events with the most money traded today, each with its leading outcome. */
export function topEvents(
  events: readonly PredictionEvent[],
  midpoints: Readonly<Record<string, number>>,
  now: number,
  count = TOP_EVENTS,
): TopEvent[] {
  return events
    .flatMap((event): TopEvent[] => {
      const leading = openOutcomes(event, now)
        .map((outcome) => ({ outcome, odds: oddsOf(outcome, midpoints[outcome.tokenId]) }))
        .sort((a, b) => b.odds - a.odds)[0];
      if (!leading) return [];
      return [{ event, ...leading, dayChange: dayChangeOf(leading.outcome, leading.odds) }];
    })
    .sort((a, b) => b.event.volume24h - a.event.volume24h)
    .slice(0, count);
}

const newYorkDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

export interface DayReleases {
  /** 'YYYY-MM-DD' in New York. */
  date: string;
  /** True when `date` is today in New York; otherwise the next day with releases. */
  today: boolean;
  releases: Release[];
}

/** Today's US releases, or the next day's when nothing is scheduled today. */
export function releasesForToday(
  releases: readonly Release[],
  now: number,
): DayReleases | undefined {
  const today = newYorkDay.format(now);
  const date = releases.find((release) => release.date >= today)?.date;
  if (date === undefined) return undefined;
  return {
    date,
    today: date === today,
    releases: releases.filter((release) => release.date === date),
  };
}
