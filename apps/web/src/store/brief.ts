import { formatNumber } from '../design/format';
import { plainName } from '../design/plain';
import type { Mover } from './movers';
import type { DailyStat, DayReleases, TopEvent } from './rundown';
import { formatDuration } from './sessions';

/**
 * E4 Daily brief: a few plain sentences about the Rundown, written by rules from the same figures
 * the page shows. No AI, no key. Every number in a sentence is printed exactly as it appears in
 * the section the sentence points to, and no sentence advises buying or selling.
 */

/** A Rundown section a sentence rests on (the element id is `rundown-<id>`). */
export type BriefRef = 'world' | 'moves' | 'crypto' | 'anchors' | 'events' | 'calendar';

export interface BriefSentence {
  text: string;
  refs: BriefRef[];
}

export interface ExchangeState {
  name: string;
  open: boolean;
  /** Minutes until it opens or closes; undefined for markets that never close. */
  minutesToChange: number | undefined;
}

export interface BriefInput {
  exchanges: readonly ExchangeState[];
  moves: readonly Mover[];
  /** Bitcoin, as on the Crypto section. */
  bitcoin: Mover | undefined;
  dollar: DailyStat | undefined;
  oil: DailyStat | undefined;
  events: readonly TopEvent[];
  calendar: DayReleases | undefined;
}

/** A change exactly as the page prints it: "+2.12%", "-1.56%". */
export const pageChange = (changePct: number): string => `${formatNumber(changePct, 2, true)}%`;

const list = (words: readonly string[]): string =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;

function exchangesSentence(exchanges: readonly ExchangeState[]): BriefSentence | undefined {
  if (exchanges.length === 0) return undefined;
  const open = exchanges.filter((exchange) => exchange.open).map((exchange) => exchange.name);
  const next = exchanges
    .filter((exchange) => !exchange.open && exchange.minutesToChange !== undefined)
    .sort((a, b) => (a.minutesToChange ?? 0) - (b.minutesToChange ?? 0))[0];
  const nextText =
    next?.minutesToChange === undefined
      ? ''
      : `${next.name} opens in ${formatDuration(next.minutesToChange)}`;
  if (open.length === 0) {
    return {
      text: `The big stock exchanges are closed${nextText ? `; ${nextText}` : ''}. Crypto trades around the clock.`,
      refs: ['world'],
    };
  }
  return {
    text: `${list(open)} ${open.length === 1 ? 'is' : 'are'} open${nextText ? `; ${nextText}` : ''}.`,
    refs: ['world'],
  };
}

function movesSentence(moves: readonly Mover[]): BriefSentence | undefined {
  const [first, ...rest] = moves.filter((move) => move.changePct !== undefined);
  if (!first || first.changePct === undefined) return undefined;
  const opposite = rest.find(
    (move) =>
      move.changePct !== undefined && Math.sign(move.changePct) !== Math.sign(first.changePct ?? 0),
  );
  const lead = `The biggest move on this page is ${plainName(first.item)}, ${pageChange(first.changePct)}`;
  if (!opposite || opposite.changePct === undefined) return { text: `${lead}.`, refs: ['moves'] };
  return {
    text: `${lead}; going the other way, ${plainName(opposite.item)} is ${pageChange(opposite.changePct)}.`,
    refs: ['moves'],
  };
}

function bitcoinSentence(bitcoin: Mover | undefined): BriefSentence | undefined {
  if (!bitcoin || bitcoin.changePct === undefined) return undefined;
  return {
    text: `Bitcoin is at ${formatNumber(bitcoin.price, bitcoin.item.decimals)} dollars, ${pageChange(bitcoin.changePct)} over 24 hours.`,
    refs: ['crypto'],
  };
}

function anchorsSentence(
  dollar: DailyStat | undefined,
  oil: DailyStat | undefined,
): BriefSentence | undefined {
  const parts = [
    dollar && dollar.changePct !== undefined
      ? `the dollar index at ${formatNumber(dollar.value, 2)} (${pageChange(dollar.changePct)})`
      : undefined,
    oil && oil.changePct !== undefined
      ? `oil at ${formatNumber(oil.value, 2)} dollars a barrel (${pageChange(oil.changePct)})`
      : undefined,
  ].filter((part): part is string => part !== undefined);
  if (parts.length === 0) return undefined;
  return { text: `At the last daily close: ${list(parts)}.`, refs: ['anchors'] };
}

function eventSentence(events: readonly TopEvent[]): BriefSentence | undefined {
  const [top] = events;
  if (!top) return undefined;
  const odds = `${formatNumber(top.odds * 100, 0)}%`;
  const what =
    top.outcome.label === 'Yes'
      ? `a ${odds} chance of “${top.event.title.replace(/\?$/, '')}”`
      : `${odds} on “${top.outcome.label}” for “${top.event.title.replace(/\?$/, '')}”`;
  return {
    text: `The event with the most money on it today: markets put ${what}. Those are market odds, not a forecast.`,
    refs: ['events'],
  };
}

function calendarSentence(calendar: DayReleases | undefined): BriefSentence | undefined {
  if (!calendar || calendar.releases.length === 0) return undefined;
  const names = list(calendar.releases.map((release) => release.name));
  return calendar.today
    ? { text: `Due today in the US: ${names}.`, refs: ['calendar'] }
    : { text: `No US releases are due today; next up: ${names}.`, refs: ['calendar'] };
}

/** The brief, in reading order; a sentence whose figures are not on screen yet is left out. */
export function writeBrief(input: BriefInput): BriefSentence[] {
  return [
    exchangesSentence(input.exchanges),
    movesSentence(input.moves),
    bitcoinSentence(input.bitcoin),
    anchorsSentence(input.dollar, input.oil),
    eventSentence(input.events),
    calendarSentence(input.calendar),
  ].filter((sentence): sentence is BriefSentence => sentence !== undefined);
}
