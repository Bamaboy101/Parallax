import { formatCompact, formatNumber } from '../../design/format';
import { sourceName } from '../../design/sources';
import type { Bar, NewsItem } from '../../feeds/types';
import type { Release } from '../calendar';
import { TRADE_CODES, type Earnings, type Ownership } from '../corporate';
import { lastPriceOf, priceChannel, priceLine } from '../hooks';
import { energyStat, PRICE_ROWS, STOCK_ROWS, SUPPLY_ROWS, type EnergyMap } from '../energy';
import { latest, monthlyChange, yearOnYear, type SeriesMap, type Stat } from '../macro';
import type { PaperState } from '../paper/store';
import type { OptionsSummary } from '../options/store';
import { basisPoints, curveOn, daysBefore } from '../rates/parse';
import type { RatesState } from '../rates/store';
import { dayChangeOf, oddsOf, openOutcomes, type PredictionEvent } from '../predictions/classify';
import { PERPS } from '../perps';
import { instrument, type Instrument } from '../symbols';
import { valueAt, type TickState } from '../ticks';
import { largestEconomies, type WorldData } from '../world';
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
  /** What each open options panel last showed, by underlying. */
  options: Readonly<Record<string, OptionsSummary>>;
  /** The rates desk's curve and overnight rates. */
  rates: Pick<RatesState, 'curve' | 'sofr' | 'effr'>;
  /** EIA series the Energy panel shows, when it is open. */
  energy?: EnergyMap | null;
  /**
   * What each open Corporate events panel shows, by its ticker ('' for the market-wide earnings
   * list): earnings from Finnhub (null without a key), insiders and holders from SEC EDGAR.
   */
  corporate?: Readonly<Record<string, CorporateFacts>> | null;
  /** IMF and World Bank figures the Global macro panel shows, when it is open. */
  world?: WorldData | null;
  /** What the Session recorder panel shows. */
  recorder?: RecorderSummary | null;
  now: number;
}

export interface RecorderSummary {
  mode: 'idle' | 'recording' | 'replaying';
  /** The recording being made, ready, or replayed: its span and size. */
  from: number | null;
  to: number | null;
  events: number;
}

export interface CorporateFacts {
  earnings: readonly Earnings[] | null;
  ownership: Ownership | null;
}

/** The Global macro table: the 50 largest economies with the IMF's figures for this year. */
function worldDetail(world: WorldData): string | null {
  const rows = largestEconomies(world.countries).map((country) => {
    const value = (number: number | null, signed = false) =>
      number === null ? 'n/a' : `${formatNumber(number, 1, signed)}%`;
    const gdp =
      country.gdpUsd === null
        ? ''
        : `, GDP $${formatCompact(country.gdpUsd)} (${country.gdpYear ?? ''})`;
    return `${country.name}: growth ${value(country.growth, true)}, inflation ${value(country.inflation)}, government debt ${value(country.debt)} of GDP${gdp}`;
  });
  return rows.length > 0
    ? `Largest economies, IMF ${world.imfEdition} estimates for ${world.year} and World Bank GDP in US dollars: ${rows.join('; ')}`
    : null;
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
    case 'options': {
      const underlying = symbol ?? 'SPY';
      const summary = input.options[underlying];
      if (!summary) return null;
      const pc = summary.putCall;
      return `${underlying} options expiring ${summary.expiry} (Alpaca indicative feed: quotes adjusted, trades 15 min delayed): spot ${formatNumber(summary.spot, 2)}, at-the-money implied volatility ${summary.atmIv === null ? 'unknown' : `${formatNumber(summary.atmIv * 100, 1)}%`}, put/call ratio ${pc.ratio === null ? 'unknown' : formatNumber(pc.ratio, 2)} by contracts traded (${formatCompact(pc.callVolume)} calls, ${formatCompact(pc.putVolume)} puts)`;
    }
    case 'rates':
      return ratesDetail(input.rates);
    case 'macro':
      return input.fred ? macroDetail(input.fred) : null;
    case 'calendar': {
      const next = (input.releases ?? []).slice(0, 8);
      return next.length > 0
        ? `Upcoming major US releases (FRED calendar, dates only): ${next.map((release) => `${release.date} ${release.name}`).join('; ')}`
        : null;
    }
    case 'energy':
      return input.energy ? energyDetail(input.energy) : null;
    case 'corporate': {
      const ticker = symbol && instrument(symbol)?.kind === 'equity' ? symbol : '';
      const facts = input.corporate?.[ticker];
      return facts ? corporateDetail(ticker, facts) : null;
    }
    case 'worldmacro':
      return input.world ? worldDetail(input.world) : null;
    case 'recorder': {
      const recorder = input.recorder;
      if (!recorder) return null;
      const span =
        recorder.from === null
          ? ''
          : ` from ${new Date(recorder.from).toISOString().slice(0, 16).replace('T', ' ')} UTC${recorder.to === null ? '' : ` to ${new Date(recorder.to).toISOString().slice(11, 16)} UTC`}`;
      if (recorder.mode === 'recording')
        return `Session recorder: recording${span}, ${String(recorder.events)} market events so far`;
      if (recorder.mode === 'replaying')
        return `Session recorder: replaying a session recorded${span} (${String(recorder.events)} market events)`;
      return recorder.from === null
        ? 'Session recorder: not recording; no recording loaded'
        : `Session recorder: a recording${span} (${String(recorder.events)} market events) is ready to save or replay`;
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

const HOUR_WORDS: Readonly<Record<Earnings['hour'], string>> = {
  bmo: 'before the open',
  amc: 'after the close',
  dmh: 'during market hours',
  '': 'time not given',
};

/** The Corporate events panel: earnings dates, insider trades and large holders, as shown. */
function corporateDetail(ticker: string, facts: CorporateFacts): string | null {
  const parts: string[] = [];
  const earnings = (facts.earnings ?? []).slice(0, ticker === '' ? 25 : 2);
  if (earnings.length > 0) {
    parts.push(
      `Earnings dates (Finnhub): ${earnings
        .map(
          (entry) =>
            `${entry.symbol} ${entry.date} ${HOUR_WORDS[entry.hour]}${entry.epsEstimate === null ? '' : `, EPS estimate ${formatNumber(entry.epsEstimate, 2)}`}`,
        )
        .join('; ')}`,
    );
  } else if (facts.earnings !== null) {
    parts.push(
      `No earnings date${ticker === '' ? 's for the catalogue' : ` for ${ticker}`} in the next two weeks (Finnhub)`,
    );
  }
  const ownership = facts.ownership;
  if (ownership) {
    const trades = ownership.insiders
      .flatMap((filing) =>
        filing.trades.map(
          (trade) =>
            `${trade.date} ${filing.owner}${filing.role ? ` (${filing.role})` : ''} ${TRADE_CODES[trade.code]?.label.toLowerCase() ?? trade.code} ${formatNumber(trade.shares, 0)} shares${trade.price === null ? '' : ` at ${formatNumber(trade.price, 2)}`}${filing.plan ? ', under a pre-arranged 10b5-1 plan' : ''}`,
        ),
      )
      .slice(0, 12);
    parts.push(
      trades.length > 0
        ? `${ticker} insider trades (SEC Form 4, latest filings): ${trades.join('; ')}`
        : `${ticker}: no insider trades in the latest Form 4 filings`,
    );
    const holders = ownership.holders.filter((filing) => filing.holder !== null);
    if (holders.length > 0) {
      parts.push(
        `${ticker} large holders (SEC Schedule 13D/13G): ${holders
          .map(
            (filing) =>
              `${filing.holder ?? ''}${filing.percent === null ? '' : ` ${formatNumber(filing.percent, 2)}%`} (${filing.form}, filed ${filing.filed})`,
          )
          .join('; ')}`,
      );
    }
  }
  return parts.length > 0 ? parts.join('. ') : null;
}
/** The Energy panel's rows: latest, weekly change and change against the five-year norm. */
function energyDetail(energy: EnergyMap): string | null {
  const lines = [...STOCK_ROWS, ...SUPPLY_ROWS, ...PRICE_ROWS].flatMap((row) => {
    const stat = energyStat(energy[row.id]);
    if (!stat) return [];
    const scaled = (value: number) => formatNumber(value / row.scale, row.decimals, true);
    const step = energy[row.id]?.cadence === 'daily' ? 'on the day' : 'on the week';
    const change = stat.change === undefined ? '' : `, ${scaled(stat.change)} ${step}`;
    const norm =
      stat.vsNorm === undefined
        ? ''
        : `, ${scaled(stat.vsNorm)} against the average change in the same week of the previous ${String(stat.normYears)} years`;
    return [
      `${row.label} ${formatNumber(stat.value / row.scale, row.decimals)} ${row.unit}${change}${norm} (as of ${stat.asOf})`,
    ];
  });
  return lines.length > 0 ? `US energy (EIA): ${lines.join('; ')}` : null;
}

/** The rates desk: key tenors with their one-month change, the 2s10s spread and overnight rates. */
function ratesDetail(rates: ContextInput['rates']): string | null {
  const latest = rates.curve.at(-1);
  const parts: string[] = [];
  if (latest) {
    const monthAgo = curveOn(rates.curve, daysBefore(latest.date, 30));
    const tenors = ['3M', '2Y', '10Y', '30Y'].flatMap((label) => {
      const value = latest.yields[label];
      if (value == null) return [];
      const change = basisPoints(value, monthAgo?.yields[label]);
      return [
        `${label} ${formatNumber(value, 2)}%${change === null ? '' : ` (${formatNumber(change, 0, true)} bp over a month)`}`,
      ];
    });
    const spread = basisPoints(latest.yields['10Y'], latest.yields['2Y']);
    parts.push(
      `US Treasury curve on ${latest.date}: ${tenors.join(', ')}${spread === null ? '' : `; 10Y minus 2Y ${formatNumber(spread, 0, true)} bp`}`,
    );
  }
  const sofr = rates.sofr.at(-1);
  if (sofr) parts.push(`SOFR ${formatNumber(sofr.rate, 2)}% on ${sofr.date}`);
  const effr = rates.effr.at(-1);
  if (effr) {
    parts.push(
      `effective fed funds rate ${formatNumber(effr.rate, 2)}% on ${effr.date}, target range ${formatNumber(effr.targetFrom, 2)}–${formatNumber(effr.targetTo, 2)}% (New York Fed)`,
    );
  }
  return parts.length > 0 ? `Official end-of-day data: ${parts.join('; ')}` : null;
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
  replay: { from: number; to: number } | null = null,
): string {
  const time = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
  const utc = (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' ');
  const lines = items.map(
    (item) =>
      `[${item.id}] ${item.kind === 'panel' ? `Panel “${item.label}”` : item.kind === 'odds' ? `Event “${item.label}”` : 'Headline'}: ${item.detail}`,
  );
  return [
    `CONTEXT (as of ${time} UTC${rewound === null ? '' : `; the user is rewound to ${new Date(rewound).toISOString().slice(11, 16)} UTC, but figures here are the latest`}):`,
    ...(replay
      ? [
          `REPLAY: the terminal is replaying a session recorded ${utc(replay.from)} to ${utc(replay.to)} UTC. Prices, trades, books and funding in the panels come from that recording, not from the markets now; say so when you use them. Headlines and published data are current.`,
        ]
      : []),
    ...(lines.length > 0 ? lines : ['(nothing on screen has figures yet)']),
    '',
    `QUESTION: ${question}`,
  ].join('\n');
}
