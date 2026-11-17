import { describe, expect, it } from 'vitest';
import { formatNumber } from '../design/format';
import { writeBrief, type BriefInput } from './brief';
import type { Mover } from './movers';
import type { Outcome, PredictionEvent } from './predictions/classify';
import { formatDuration } from './sessions';
import { instrument } from './symbols';

const mover = (id: string, price: number, changePct: number): Mover => {
  const item = instrument(id);
  if (!item) throw new Error(`${id} missing`);
  return { item, price, changePct, tradedUsd: 0, source: 'coinbase' };
};

const outcome: Outcome = {
  label: '25 bps cut',
  tokenId: 't',
  price: 0.6,
  dayChange: null,
  lastTrade: null,
  wideSpread: false,
  ends: null,
};
const event: PredictionEvent = {
  id: 'fed',
  slug: 'fed',
  title: 'Fed decision in December?',
  theme: 'central-banks',
  region: 'us',
  endDate: null,
  volume24h: 1,
  volume: 1,
  outcomes: [outcome],
  assets: [],
};

const solana = mover('SOL-USD', 73.38, 2.123);
const bitcoin = mover('BTC-USD', 64_223.14, -1.5649);

const INPUT: BriefInput = {
  exchanges: [
    { name: 'London', open: true, minutesToChange: 125 },
    { name: 'New York', open: false, minutesToChange: 200 },
    { name: 'Tokyo', open: false, minutesToChange: 900 },
  ],
  moves: [solana, bitcoin],
  bitcoin,
  dollar: { value: 122.6503, changePct: 0.0873, asOf: '2026-11-13' },
  oil: { value: 89.62, changePct: -0.0001, asOf: '2026-11-11' },
  events: [{ event, outcome, odds: 0.634, dayChange: null }],
  calendar: {
    date: '2026-11-18',
    today: true,
    releases: [
      { date: '2026-11-18', id: 9, name: 'Retail Sales' },
      { date: '2026-11-18', id: 13, name: 'Industrial Production' },
    ],
  },
};

/** Numbers as the Rundown prints them, section by section. */
const ON_SCREEN: Record<string, string[]> = {
  world: [formatDuration(125), formatDuration(200), formatDuration(900)],
  moves: [`${formatNumber(2.123, 2, true)}%`, `${formatNumber(-1.5649, 2, true)}%`],
  crypto: [formatNumber(64_223.14, 2), `${formatNumber(-1.5649, 2, true)}%`],
  anchors: [
    formatNumber(122.6503, 2),
    `${formatNumber(0.0873, 2, true)}%`,
    formatNumber(89.62, 2),
    `${formatNumber(-0.0001, 2, true)}%`,
  ],
  // The odds, and the outcome label ("25 bps cut") the section prints beside them.
  events: [`${formatNumber(63.4, 0)}%`, '25'],
  calendar: [],
};

describe('daily brief', () => {
  const brief = writeBrief(INPUT);

  it('writes one plain sentence per Rundown section, in reading order', () => {
    expect(brief.map((sentence) => sentence.text)).toEqual([
      'London is open; New York opens in 3h 20m.',
      'The biggest move on this page is Solana, +2.12%; going the other way, Bitcoin is -1.56%.',
      'Bitcoin is at 64,223.14 dollars, -1.56% over 24 hours.',
      'At the last daily close: the dollar index at 122.65 (+0.09%) and oil at 89.62 dollars a barrel (0.00%).',
      'The event with the most money on it today: markets put 63% on “25 bps cut” for “Fed decision in December”. Those are market odds, not a forecast.',
      'Due today in the US: Retail Sales and Industrial Production.',
    ]);
  });

  it('uses only numbers printed in the sections each sentence points to', () => {
    for (const sentence of brief) {
      const allowed = sentence.refs.flatMap((ref) => ON_SCREEN[ref] ?? []);
      // Figures are "64,223.14", "+2.12%", "3h 20m"; "24 hours" is the label of the window.
      const figures =
        sentence.text
          .replace(/\b24 hours\b/g, '')
          .match(/[+-]?\d[\d,]*(?:\.\d+)?(?:%|h \d+m|m\b)?/g) ?? [];
      for (const figure of figures) expect(allowed).toContain(figure);
    }
  });

  it('never advises buying or selling', () => {
    for (const sentence of brief) {
      expect(sentence.text).not.toMatch(/\b(buy|sell|should|recommend|opportunity)\b/i);
    }
  });

  it('leaves out what the page does not show yet, and says when exchanges are all shut', () => {
    const quiet = writeBrief({
      exchanges: [{ name: 'London', open: false, minutesToChange: 60 }],
      moves: [],
      bitcoin: undefined,
      dollar: undefined,
      oil: undefined,
      events: [],
      calendar: undefined,
    });
    expect(quiet).toEqual([
      {
        text: 'The big stock exchanges are closed; London opens in 1h 0m. Crypto trades around the clock.',
        refs: ['world'],
      },
    ]);
  });
});
