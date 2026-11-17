import { SymbolLabel } from '../../design/SymbolLabel';
import type { IDockviewPanelProps } from 'dockview-react';
import { memo, useMemo, useState } from 'react';
import { Cell } from '../../design/Cell';
import { formatCompact } from '../../design/format';
import '../../design/market.css';
import { failureNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import '../../design/predictions.css';
import { usePriceLine, useCursor } from '../../store/hooks';
import { daysBefore, latest, useFred, type Stat } from '../../store/macro';
import { useReportSources } from '../../store/panels';
import {
  dayChangeOf,
  eventUrl,
  oddsOf,
  openOutcomes,
  REGIONS,
  THEMES,
  type AssetLink,
  type Outcome,
  type PredictionEvent,
  type Theme,
} from '../../store/predictions/classify';
import {
  POLYMARKET_SOURCE,
  useOddsHistory,
  usePredictionsFeed,
  usePredictionStore,
  type OddsPoint,
} from '../../store/predictions/store';
import { instrument, type Instrument } from '../../store/symbols';
import { RowReason } from '../RowReason';
import { useNow } from '../useNow';
import { useVisibleRows } from '../useVisibleRows';

interface PredictionsParams {
  query?: string;
}

const SOURCES = [POLYMARKET_SOURCE];
/** Outcomes a row shows beside the lead one in its detail and chart. */
const DETAIL_OUTCOMES = 3;
const NOW_REFRESH_MS = 60_000;

const toneOf = (change: number | null | undefined) =>
  change == null || Math.abs(change) < 0.0005 ? 'neutral' : change > 0 ? 'up' : 'down';

const endFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** An outcome's odds and 24 h change in percentage points, from the store's latest midpoints. */
function useOdds(outcome: Outcome | undefined): {
  odds: number | undefined;
  change: number | null;
} {
  const midpoint = usePredictionStore((state) =>
    outcome === undefined ? undefined : state.midpoints[outcome.tokenId],
  );
  if (!outcome) return { odds: undefined, change: null };
  const odds = oddsOf(outcome, midpoint);
  return { odds, change: dayChangeOf(outcome, odds) };
}

/** A linked asset: a catalogue instrument's price and change, or the US 2-year yield. */
const AssetChip = memo(function AssetChip({
  link,
  twoYear,
  background,
}: {
  link: AssetLink;
  twoYear: Stat | undefined;
  background: boolean;
}) {
  if (link.kind === 'yield') {
    return (
      <span className="odds-asset" title="US 2-year Treasury yield, FRED daily close">
        <span className="odds-asset-label">US 2Y</span>
        <Cell value={twoYear?.value} decimals={2} suffix="%" />
        <Cell
          value={twoYear?.change === undefined ? undefined : twoYear.change * 100}
          decimals={0}
          signed
          suffix="bp"
          tone={toneOf(twoYear?.change)}
        />
      </span>
    );
  }
  const item = instrument(link.id);
  return item ? <PricedChip item={item} background={background} /> : null;
});

function PricedChip({ item, background }: { item: Instrument; background: boolean }) {
  const line = usePriceLine(item, background);
  return (
    <span className="odds-asset" title={`${item.name}${item.note ? ` · ${item.note}` : ''}`}>
      <span className="odds-asset-label">
        <SymbolLabel item={item} />
      </span>
      {line.price === undefined ? (
        <RowReason symbol={item} label={item.label} />
      ) : (
        <Cell value={line.changePct} decimals={2} signed suffix="%" tone={toneOf(line.changePct)} />
      )}
    </span>
  );
}

const EventRow = memo(function EventRow({
  event,
  now,
  selected,
  visible,
  observe,
  onSelect,
  twoYear,
}: {
  event: PredictionEvent;
  now: number;
  selected: boolean;
  visible: boolean;
  observe: (element: HTMLElement | null) => void;
  onSelect: (id: string) => void;
  twoYear: Stat | undefined;
}) {
  const open = openOutcomes(event, now);
  const lead = open[0];
  const { odds, change } = useOdds(lead);
  const multi = event.outcomes.length > 1;

  return (
    <li
      ref={observe}
      data-row={event.id}
      className="odds-event"
      aria-current={selected ? 'true' : undefined}
    >
      <button
        type="button"
        className="odds-row"
        aria-expanded={selected}
        onClick={() => {
          onSelect(event.id);
        }}
      >
        <span className="odds-title">{event.title}</span>
        <span
          className="odds-lead"
          title={multi ? 'Most likely outcome, by market odds' : undefined}
        >
          <span className="odds-metric-label">Market odds</span>
          {multi && lead ? <span className="odds-outcome">{lead.label}</span> : null}
          <Cell value={odds === undefined ? undefined : odds * 100} decimals={0} suffix="%" />
        </span>
        <span className="odds-change" title="Change in the last 24 hours, in percentage points">
          <span className="odds-metric-label">24 h change</span>
          <Cell
            value={change === null ? undefined : change * 100}
            decimals={1}
            signed
            suffix=" pt"
            tone={toneOf(change)}
          />
        </span>
        <span className="odds-volume" title="Traded in the last 24 hours">
          <span className="odds-metric-label">24 h volume</span>${formatCompact(event.volume24h)}
        </span>
      </button>
      <div className="odds-assets" aria-label="Linked assets">
        {event.assets.map((link) => (
          <AssetChip
            key={link.kind === 'yield' ? link.series : link.id}
            link={link}
            twoYear={twoYear}
            background={!visible}
          />
        ))}
      </div>
      {selected && <EventDetail event={event} now={now} />}
    </li>
  );
});

function OutcomeLine({ outcome }: { outcome: Outcome }) {
  const { odds, change } = useOdds(outcome);
  return (
    <li className="odds-outcome-row">
      <span className="odds-outcome-label">{outcome.label}</span>
      <Cell value={odds === undefined ? undefined : odds * 100} decimals={1} suffix="%" />
      <Cell
        value={change === null ? undefined : change * 100}
        decimals={1}
        signed
        suffix=" pt"
        tone={toneOf(change)}
      />
    </li>
  );
}

const CHART_W = 320;
const CHART_H = 96;
const LINE_CLASSES = ['odds-line', 'odds-line is-second', 'odds-line is-third'];

/** A week of hourly odds for up to three outcomes, 0 to 100% on a fixed scale. */
function OddsChart({ outcomes }: { outcomes: readonly Outcome[] }) {
  const tokens = useMemo(() => outcomes.map((outcome) => outcome.tokenId), [outcomes]);
  const history = useOddsHistory(tokens);
  if (history.state === 'loading') return <p className="panel-empty">Loading a week of odds…</p>;
  if (history.failure) {
    return <PanelNotice notice={failureNotice(history.failure, 'Odds history')} compact />;
  }
  const all: OddsPoint[] = tokens.flatMap((token) => history.series[token] ?? []);
  const first = Math.min(...all.map((point) => point.t));
  const last = Math.max(...all.map((point) => point.t));
  if (all.length === 0 || last <= first) {
    return <p className="panel-empty">No trades in the last week.</p>;
  }
  const x = (t: number) => ((t - first) / (last - first)) * CHART_W;
  const y = (p: number) => (1 - p) * CHART_H;
  return (
    <figure className="odds-chart">
      <svg
        viewBox={`0 0 ${String(CHART_W)} ${String(CHART_H)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Market odds over the last week"
      >
        {[0.25, 0.5, 0.75].map((level) => (
          <line key={level} className="odds-grid" x1={0} x2={CHART_W} y1={y(level)} y2={y(level)} />
        ))}
        {tokens.map((token, index) => (
          <polyline
            key={token}
            className={LINE_CLASSES[index]}
            points={(history.series[token] ?? [])
              .map((point) => `${x(point.t).toFixed(1)},${y(point.p).toFixed(1)}`)
              .join(' ')}
          />
        ))}
      </svg>
      <figcaption className="odds-legend">
        {outcomes.map((outcome, index) => (
          <span key={outcome.tokenId} className={`odds-key ${LINE_CLASSES[index] ?? ''}`}>
            {outcome.label}
          </span>
        ))}
        <span className="odds-axis">7 days · 0–100%</span>
      </figcaption>
    </figure>
  );
}

function EventDetail({ event, now }: { event: PredictionEvent; now: number }) {
  const open = openOutcomes(event, now);
  const charted = useMemo(() => open.slice(0, DETAIL_OUTCOMES), [open]);
  return (
    <div className="odds-detail">
      <div className="odds-detail-heading">
        <span>Outcome history</span>
        <span>1 week · market odds</span>
      </div>
      <OddsChart outcomes={charted} />
      <div className="odds-outcome-row odds-outcome-head" aria-hidden="true">
        <span>Outcome</span>
        <span>Odds</span>
        <span>24 h · pt</span>
      </div>
      <ul className="odds-outcomes">
        {open.map((outcome) => (
          <OutcomeLine key={outcome.tokenId} outcome={outcome} />
        ))}
      </ul>
      <p className="odds-meta">
        {event.endDate !== null && <span>Resolves by {endFormat.format(event.endDate)}</span>}
        <span>${formatCompact(event.volume)} traded in total</span>
        <a href={eventUrl(event)} target="_blank" rel="noreferrer">
          Rules on Polymarket ↗
        </a>
      </p>
    </div>
  );
}

const matches = (event: PredictionEvent, query: string) =>
  query === '' || query.split(/\s+/).every((word) => event.title.toLowerCase().includes(word));

/**
 * Prediction-market odds on events that move markets (M1), from Polymarket's public data:
 * grouped by theme and region, each linked to the assets it moves. Odds are what traders pay,
 * not a forecast.
 */
export default function Predictions({ api, params }: IDockviewPanelProps<PredictionsParams>) {
  usePredictionsFeed();
  useReportSources(api.id, SOURCES);
  const status = usePredictionStore((state) => state.state);
  const events = usePredictionStore((state) => state.events);
  const failure = usePredictionStore((state) => state.failure);
  const [cursor] = useCursor();
  const now = useNow(NOW_REFRESH_MS);
  const [theme, setTheme] = useState<Theme | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const { root, row, isVisible } = useVisibleRows();
  const query = (params.query ?? '').trim().toLowerCase();

  // Fed-linked rows show the US 2-year yield beside gold and the dollar.
  const today = new Date(now).toISOString().slice(0, 10);
  const fred = useFred(['DGS2'], daysBefore(today, 14));
  const twoYear = latest(fred.series.DGS2);

  const shown = events.filter(
    (event) =>
      (theme === 'all' || event.theme === theme) &&
      matches(event, query) &&
      openOutcomes(event, now).length > 0,
  );
  const groups = THEMES.filter((entry) => theme === 'all' || entry.id === theme).flatMap(
    (entry) => {
      const inTheme = shown.filter((event) => event.theme === entry.id);
      if (inTheme.length === 0) return [];
      const regions = REGIONS.flatMap((region) => {
        const list = inTheme.filter((event) => event.region === region.id);
        return list.length === 0 ? [] : [{ region, list }];
      });
      return [{ theme: entry, regions }];
    },
  );

  const toggle = (id: string) => {
    setSelected((current) => (current === id ? null : id));
  };

  return (
    <div className="market-panel odds-panel">
      <div className="panel-toolbar">
        <span className="panel-heading">Market odds, not forecasts</span>
        <span className="panel-caption">
          {query === '' ? 'Polymarket' : `“${params.query ?? ''}” · Polymarket`}
        </span>
      </div>
      <div className="odds-themes" role="group" aria-label="Theme">
        {[{ id: 'all' as const, title: 'All' }, ...THEMES].map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="chart-interval"
            aria-pressed={theme === entry.id}
            onClick={() => {
              setTheme(entry.id);
            }}
          >
            {entry.title}
          </button>
        ))}
      </div>
      <p className="odds-disclaimer">
        What traders pay for each outcome; thin markets can be wrong.
      </p>
      {cursor !== null && (
        <p className="odds-disclaimer">Rewind replays market feeds only: odds here are live.</p>
      )}
      {failure && (
        <PanelNotice notice={failureNotice(failure, 'Polymarket')} compact={events.length > 0} />
      )}
      {status === 'loading' && <p className="panel-empty">Loading market odds…</p>}
      {status === 'ready' && groups.length === 0 && (
        <p className="panel-empty">
          {query === ''
            ? 'No market-moving events open right now.'
            : `No open events match “${params.query ?? ''}”.`}
        </p>
      )}
      <div ref={root} className="odds-list">
        {groups.map(({ theme: entry, regions }) => (
          <section key={entry.id} aria-label={entry.title}>
            <h3 className="markets-group">{entry.title}</h3>
            {regions.map(({ region, list }) => (
              <section key={region.id} aria-label={`${entry.title}: ${region.title}`}>
                <h4 className="odds-region">{region.title}</h4>
                <ul>
                  {list.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      now={now}
                      selected={selected === event.id}
                      visible={isVisible(event.id)}
                      observe={row}
                      onSelect={toggle}
                      twoYear={twoYear}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
