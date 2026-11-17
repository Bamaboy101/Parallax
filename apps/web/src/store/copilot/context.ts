import { formatCompact, formatNumber } from '../../design/format';
import { sourceName } from '../../design/sources';
import type { Bar, NewsItem } from '../../feeds/types';
import type { Release } from '../calendar';
import { lastPriceOf, priceChannel, priceLine } from '../hooks';
import { latest, monthlyChange, yearOnYear, type SeriesMap, type Stat } from '../macro';
import type { PaperState } from '../paper/store';
import { dayChangeOf, oddsOf, openOutcomes, type PredictionEvent } from '../predictions/classify';
import { PERPS } from '../perps';
import { instrument, type Instrument } from '../symbols';
import { valueAt, type TickState } from '../ticks';
import { computeMovers } from '../movers';

/** One thing the co-pilot can cite: a panel on screen, an event's odds or a headline. */
export interface ContextItem {
  id: string;
  kind: 'panel' | 'odds' | 'headline';
  /** What the user sees: 'Watchlist', 'Fed Decision in December?', a headline. */
  label: string;
  /** The figures handed to the AI for this item. */
  detail: string;
  url?: string;
}

/** A dock panel as the co-pilot sees it. */
export interface PanelRef {
  component: string;
  title: string;
  params: Readonly<Record<string, unknown>>;
  /** For boards with fixed rows (World markets, FX, Europe, Asia-Pacific): their symbol ids. */
  symbols?: readonly string[];
}

export interface ContextInput {
  panels: readonly PanelRef[];
  ticks: TickState;
  barsOf: (item: Instrument) => readonly Bar[] | undefined;
  events: readonly PredictionEvent[];
  midpoints: Readonly<Record<string, number>>;
  paper: Pick<PaperState, 'account' | 'positions'> | null;
  headlines: readonly NewsItem[];
  /** FRED series the Macro panel shows, when it is open. */
  fred: SeriesMap | null;
  /** Upcoming releases the Calendar panel shows, when it is open. */
  releases: readonly Release[] | null;
  now: number;
}

const pct = (value: number | undefined) =>
  value === undefined ? 'change unknown' : `${formatNumber(value, 2, true)}%`;

/** "BTC/USD 64,702.44 (−0.28% over 24 h, live from Coinbase)" or nothing without a price. */
function priceFact(input: ContextInput, item: Instrument): string | null {
  const tick = valueAt(input.ticks, priceChannel(item), item.id);
  if (!tick) return null;
  const last = lastPriceOf(tick);
  const line = priceLine(item, last, input.barsOf(item) ?? []);
  const window = item.kind === 'equity' ? 'since the previous close' : 'over 24 h';
  const note = item.note ? `, ${item.note}` : '';
  return `${item.label} ${formatNumber(last.price, item.decimals)} (${pct(line.changePct)} ${window}, from ${sourceName(last.source)}${note})`;
}

const facts = (input: ContextInput, ids: readonly string[]) =>
  ids.flatMap((id) => {
    const item = instrument(id);
    const fact = item ? priceFact(input, item) : null;
    return fact ? [fact] : [];
  });

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** What a panel shows, in figures, or null when it has nothing to say. */
function panelDetail(input: ContextInput, panel: PanelRef): string | null {
  const symbol = typeof panel.params.symbol === 'string' ? panel.params.symbol : undefined;
  switch (panel.component) {
    case 'watchlist':
    case 'constellation': {
      const lines = facts(input, stringList(panel.params.symbols));
      return lines.length > 0 ? lines.join('; ') : null;
    }
    case 'chart':
    case 'book':
    case 'tape':
      return symbol ? (facts(input, [symbol])[0] ?? null) : null;
    case 'markets':
    case 'europe':
    case 'asia-pacific':
    case 'fx': {
      const lines = facts(input, panel.symbols ?? []).slice(0, 30);
      return lines.length > 0 ? lines.join('; ') : null;
    }
    case 'movers': {
      const view = computeMovers(input.ticks, input.barsOf, input.now);
      if (view.universe.length === 0) return null;
      const list = (movers: typeof view.gainers) =>
        movers.map((mover) => `${mover.item.label} ${pct(mover.changePct)}`).join(', ') || 'none';
      return `Breadth ${String(view.breadth.up)} up, ${String(view.breadth.down)} down. Top gainers: ${list(view.gainers)}. Top losers: ${list(view.losers)}.`;
    }
    case 'derivs': {
      const lines = PERPS.flatMap((perp) => {
        const tick = valueAt(input.ticks, 'deriv', perp.id);
        if (!tick) return [];
        const oi =
          tick.openInterestUsd === null
            ? ''
            : `, open interest $${formatCompact(tick.openInterestUsd)}`;
        return [
          `${perp.base} perpetual mark ${formatNumber(tick.markPrice, perp.decimals)}, funding ${formatNumber(tick.fundingRate * 100, 4, true)}% per interval${oi}`,
        ];
      });
      return lines.length > 0 ? lines.join('; ') : null;
    }
    case 'paper': {
      const account = input.paper?.account;
      if (!account) return null;
      const positions = input.paper?.positions ?? [];
      const held = positions
        .map(
          (position) =>
            `${position.symbol} ${formatNumber(position.qty, 0)} shares, unrealised ${formatNumber(position.unrealizedPl, 2, true)} USD`,
        )
        .join('; ');
      return `Simulated (fake money) paper account: equity ${formatNumber(account.equity, 2)} USD, today ${formatNumber(account.equity - account.lastEquity, 2, true)} USD. ${held === '' ? 'No positions.' : `Positions: ${held}.`}`;
    }
    case 'macro':
      return input.fred ? macroDetail(input.fred) : null;
    case 'calendar': {
      const next = (input.releases ?? []).slice(0, 8);
      return next.length > 0
        ? `Upcoming major US releases (FRED calendar, dates only): ${next.map((release) => `${release.date} ${release.name}`).join('; ')}`
        : null;
    }
    default:
      return null;
  }
}

const stat = (
  label: string,
  value: Stat | undefined,
  decimals: number,
  unit: string,
  signed = false,
) =>
  value
    ? [`${label} ${formatNumber(value.value, decimals, signed)}${unit} (as of ${value.asOf})`]
    : [];

/** The Macro panel's rows, from the same FRED series and the same calculations. */
function macroDetail(fred: SeriesMap): string | null {
  const ten = latest(fred.DGS10);
  const two = latest(fred.DGS2);
  const lines = [
    ...stat('2-year Treasury yield', two, 2, '%'),
    ...stat('10-year Treasury yield', ten, 2, '%'),
    ...(ten && two ? [`10Y − 2Y spread ${formatNumber(ten.value - two.value, 2, true)} pp`] : []),
    ...stat('Fed funds (effective)', latest(fred.DFF), 2, '%'),
    ...stat('CPI inflation, year on year', yearOnYear(fred.CPIAUCSL), 1, '%'),
    ...stat('Unemployment rate', latest(fred.UNRATE), 1, '%'),
    ...stat('Payrolls, monthly change', monthlyChange(fred.PAYEMS), 0, 'k jobs', true),
  ];
  return lines.length > 0 ? `Official FRED data, daily or monthly: ${lines.join('; ')}` : null;
}

/** Up to eight market-moving events with their odds and 24 h change. */
function oddsItems(input: ContextInput, start: number): ContextItem[] {
  return input.events.slice(0, 8).flatMap((event, index) => {
    const outcomes = openOutcomes(event, input.now).slice(0, 3);
    if (outcomes.length === 0) return [];
    const text = outcomes
      .map((outcome) => {
        const odds = oddsOf(outcome, input.midpoints[outcome.tokenId]);
        const change = dayChangeOf(outcome, odds);
        return `${outcome.label} ${formatNumber(odds * 100, 0)}%${change === null ? '' : ` (${formatNumber(change * 100, 1, true)} points in 24 h)`}`;
      })
      .join(', ');
    return [
      {
        id: `O${String(start + index)}`,
        kind: 'odds' as const,
        label: event.title,
        detail: `Market odds, not forecasts (Polymarket): ${text}`,
      },
    ];
  });
}

/**
 * What is on the user's screen, as citable items: each panel with its latest figures, the
 * market-moving event odds when an Event odds panel is open, and recent headlines.
 */
export function buildContext(input: ContextInput): ContextItem[] {
  const panels = input.panels.flatMap((panel) => {
    const detail = panelDetail(input, panel);
    return detail ? [{ panel, detail }] : [];
  });
  const items: ContextItem[] = panels.map(({ panel, detail }, index) => ({
    id: `P${String(index + 1)}`,
    kind: 'panel',
    label: panel.title,
    detail,
  }));
  if (input.panels.some((panel) => panel.component === 'predictions'))
    items.push(...oddsItems(input, 1));
  input.headlines.slice(0, 12).forEach((headline, index) => {
    items.push({
      id: `N${String(index + 1)}`,
      kind: 'headline',
      label: headline.title,
      detail: `${headline.source}${headline.published > 0 ? `, ${new Date(headline.published).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}: ${headline.title}${headline.summary ? `. ${headline.summary.slice(0, 200)}` : ''}`,
      url: headline.url,
    });
  });
  return items;
}

/** The user message: the context, then the question. */
export function contextMessage(
  items: readonly ContextItem[],
  question: string,
  now: number,
  rewound: number | null,
): string {
  const time = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
  const lines = items.map(
    (item) =>
      `[${item.id}] ${item.kind === 'panel' ? `Panel “${item.label}”` : item.kind === 'odds' ? `Event “${item.label}”` : 'Headline'}: ${item.detail}`,
  );
  return [
    `CONTEXT (as of ${time} UTC${rewound === null ? '' : `; the user is rewound to ${new Date(rewound).toISOString().slice(11, 16)} UTC, but figures here are the latest`}):`,
    ...(lines.length > 0 ? lines : ['(nothing on screen has figures yet)']),
    '',
    `QUESTION: ${question}`,
  ].join('\n');
}
