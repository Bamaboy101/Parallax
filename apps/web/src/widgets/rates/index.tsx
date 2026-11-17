import type { IDockviewPanelProps } from 'dockview-react';
import { useMemo } from 'react';
import { Cell } from '../../design/Cell';
import { formatNumber } from '../../design/format';
import '../../design/market.css';
import { failureNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import '../../design/rates.css';
import { useReportSources } from '../../store/panels';
import { oddsOf, openOutcomes } from '../../store/predictions/classify';
import { usePredictionsFeed, usePredictionStore } from '../../store/predictions/store';
import {
  basisPoints,
  curveOn,
  daysBefore,
  targetPath,
  TENORS,
  type CurveDay,
  type RefRate,
} from '../../store/rates/parse';
import {
  NYFED_SOURCE,
  TREASURY_SOURCE,
  useRatesFeed,
  useRatesStore,
} from '../../store/rates/store';
import { useNow } from '../useNow';

const SOURCES = [TREASURY_SOURCE, NYFED_SOURCE];
const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const show = (date: string, format = dateFormat) => format.format(Date.parse(`${date}T12:00:00Z`));

const CURVE_W = 320;
const CURVE_H = 110;

/** The curve now, a month ago and a year ago, tenors evenly spaced. */
function CurveChart({
  lines,
}: {
  lines: readonly { day: CurveDay; className: string; label: string }[];
}) {
  const values = lines.flatMap(({ day }) =>
    TENORS.flatMap(({ label }) => {
      const value = day.yields[label];
      return value == null ? [] : [value];
    }),
  );
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.1, 0.05);
  const x = (index: number) => (index / (TENORS.length - 1)) * CURVE_W;
  const y = (value: number) => (1 - (value - (low - pad)) / (high - low + 2 * pad)) * CURVE_H;
  return (
    <figure className="rates-chart">
      <svg
        viewBox={`0 0 ${String(CURVE_W)} ${String(CURVE_H)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="US Treasury yield curve now, a month ago and a year ago"
      >
        {lines.map(({ day, className }) => (
          <polyline
            key={day.date}
            className={className}
            points={TENORS.flatMap(({ label }, index) => {
              const value = day.yields[label];
              return value == null ? [] : [`${x(index).toFixed(1)},${y(value).toFixed(1)}`];
            }).join(' ')}
          />
        ))}
      </svg>
      <div className="rates-ticks" aria-hidden="true">
        {TENORS.map(({ label }) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <figcaption className="rates-legend">
        {lines.map(({ day, className, label }) => (
          <span key={day.date} className={`rates-key ${className}`}>
            {label} · {show(day.date, shortDate)}
          </span>
        ))}
        <span className="rates-axis">
          {formatNumber(low, 2)}–{formatNumber(high, 2)}%
        </span>
      </figcaption>
    </figure>
  );
}

const PATH_W = 320;
const PATH_H = 72;

/** The FOMC target range as a band over the last year, with the effective rate inside it. */
function FedPath({ effr }: { effr: readonly RefRate[] }) {
  const days = effr.filter((day) => day.targetFrom !== null && day.targetTo !== null);
  if (days.length < 2) return null;
  const first = Date.parse(days[0]?.date ?? '');
  const last = Date.parse(days.at(-1)?.date ?? '');
  const values = days.flatMap((day) => [
    day.rate,
    day.targetFrom ?? day.rate,
    day.targetTo ?? day.rate,
  ]);
  const low = Math.min(...values) - 0.1;
  const high = Math.max(...values) + 0.1;
  const x = (date: string) => ((Date.parse(date) - first) / (last - first || 1)) * PATH_W;
  const y = (value: number) => (1 - (value - low) / (high - low)) * PATH_H;
  const band = [
    ...days.map((day) => `${x(day.date).toFixed(1)},${y(day.targetTo ?? day.rate).toFixed(1)}`),
    ...[...days]
      .reverse()
      .map((day) => `${x(day.date).toFixed(1)},${y(day.targetFrom ?? day.rate).toFixed(1)}`),
  ].join(' ');
  return (
    <svg
      className="rates-path"
      viewBox={`0 0 ${String(PATH_W)} ${String(PATH_H)}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Fed funds target range and effective rate over the last year"
    >
      <polygon className="rates-band" points={band} />
      <polyline
        className="rates-effr"
        points={days.map((day) => `${x(day.date).toFixed(1)},${y(day.rate).toFixed(1)}`).join(' ')}
      />
    </svg>
  );
}

/** Upcoming Fed decisions on Polymarket: market odds, not forecasts. */
function NextMeetings({ now }: { now: number }) {
  usePredictionsFeed();
  const events = usePredictionStore((state) => state.events);
  const midpoints = usePredictionStore((state) => state.midpoints);
  const meetings = useMemo(
    () =>
      events
        .filter((event) => /^Fed Decision in /i.test(event.title))
        .filter((event) => event.endDate === null || event.endDate > now)
        .sort((a, b) => (a.endDate ?? Infinity) - (b.endDate ?? Infinity))
        .slice(0, 3),
    [events, now],
  );
  if (meetings.length === 0) return null;
  return (
    <ul className="rates-meetings" aria-label="Next Fed decisions, market odds">
      {meetings.map((event) => {
        const lead = openOutcomes(event, now)[0];
        const odds = lead ? oddsOf(lead, midpoints[lead.tokenId]) : undefined;
        return (
          <li key={event.id}>
            <span>{event.title.replace(/\?$/, '')}</span>
            <span className="rates-meeting-lead">
              {lead?.label ?? '—'}{' '}
              <Cell value={odds === undefined ? null : odds * 100} decimals={0} suffix="%" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The rates desk (M3): the full Treasury curve with its changes, SOFR and the fed funds rate,
 * the target range over the last year, and the market's odds for the next Fed decisions.
 */
export default function Rates({ api }: IDockviewPanelProps) {
  useRatesFeed();
  useReportSources(api.id, SOURCES);
  const rates = useRatesStore();
  const now = useNow(60_000);
  const latest = rates.curve.at(-1);
  const prior = rates.curve.at(-2);
  const monthAgo = latest ? curveOn(rates.curve, daysBefore(latest.date, 30)) : undefined;
  const yearAgo = latest ? curveOn(rates.curve, daysBefore(latest.date, 365)) : undefined;
  const sofr = rates.sofr.at(-1);
  const effr = rates.effr.at(-1);
  const path = useMemo(() => targetPath(rates.effr), [rates.effr]);
  const changes = path
    .filter((step) => step.moveBp !== null)
    .slice(-4)
    .reverse();
  const spread = (long: string, short: string, day: CurveDay | undefined) =>
    basisPoints(day?.yields[long], day?.yields[short]);

  return (
    <div className="market-panel rates-panel">
      <div className="panel-toolbar">
        <span className="panel-heading">Rates desk</span>
        <span className="panel-caption">US Treasury · New York Fed · end of day</span>
      </div>
      {rates.failure && (
        <PanelNotice
          notice={failureNotice(rates.failure, 'Rates')}
          compact={rates.state === 'ready'}
        />
      )}
      {rates.state === 'loading' && (
        <p className="panel-empty">Loading the yield curve and money-market rates…</p>
      )}
      {latest && (
        <section aria-label="Treasury yield curve">
          <h3 className="markets-group">Treasury curve · {show(latest.date)}</h3>
          <CurveChart
            lines={[
              ...(yearAgo
                ? [{ day: yearAgo, className: 'rates-line is-year', label: '1 year ago' }]
                : []),
              ...(monthAgo
                ? [{ day: monthAgo, className: 'rates-line is-month', label: '1 month ago' }]
                : []),
              { day: latest, className: 'rates-line', label: 'Latest' },
            ]}
          />
          <ul
            className="rates-comparison"
            aria-label="Yield and historical changes in basis points"
          >
            <li className="market-columns rates-columns" aria-hidden="true">
              <span>Tenor</span>
              <span className="text-right">Yield</span>
              <span className="text-right">1d</span>
              <span className="text-right">1m</span>
              <span className="text-right">1y</span>
            </li>
            {TENORS.map(({ label }) => {
              const value = latest.yields[label];
              return (
                <li key={label} className="market-row rates-columns">
                  <span className="market-symbol">{label}</span>
                  <Cell value={value} decimals={2} suffix="%" />
                  <Cell
                    value={basisPoints(value, prior?.yields[label])}
                    decimals={0}
                    signed
                    suffix=" bp"
                  />
                  <Cell
                    value={basisPoints(value, monthAgo?.yields[label])}
                    decimals={0}
                    signed
                    suffix=" bp"
                  />
                  <Cell
                    value={basisPoints(value, yearAgo?.yields[label])}
                    decimals={0}
                    signed
                    suffix=" bp"
                  />
                </li>
              );
            })}
          </ul>
          <dl className="rates-figures rates-spreads">
            <div>
              <dt>2s10s</dt>
              <dd>
                <Cell value={spread('10Y', '2Y', latest)} decimals={0} signed suffix=" bp" />
              </dd>
            </div>
            <div>
              <dt>3m10y</dt>
              <dd>
                <Cell value={spread('10Y', '3M', latest)} decimals={0} signed suffix=" bp" />
              </dd>
            </div>
          </dl>
        </section>
      )}
      {(sofr ?? effr) && (
        <section aria-label="Money markets">
          <h3 className="markets-group">Overnight rates</h3>
          <dl className="rates-figures">
            {sofr && (
              <div>
                <dt>SOFR</dt>
                <dd>
                  <Cell value={sofr.rate} decimals={2} suffix="%" />
                  <span className="rates-note">
                    {show(sofr.date, shortDate)} · 1st–99th pct {formatNumber(sofr.low, 2)}–
                    {formatNumber(sofr.high, 2)}% · ${formatNumber(sofr.volumeBillions, 0)}bn
                  </span>
                </dd>
              </div>
            )}
            {effr && (
              <div>
                <dt>EFFR</dt>
                <dd>
                  <Cell value={effr.rate} decimals={2} suffix="%" />
                  <span className="rates-note">
                    {show(effr.date, shortDate)} · target {formatNumber(effr.targetFrom, 2)}–
                    {formatNumber(effr.targetTo, 2)}%
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}
      {rates.effr.length > 1 && (
        <section aria-label="Fed funds path">
          <h3 className="markets-group">Fed funds path · last 12 months</h3>
          <div className="rates-path-block">
            <FedPath effr={rates.effr} />
            <p className="rates-legend">
              <span className="rates-key is-band">Target range</span>
              <span className="rates-key">Effective rate</span>
            </p>
            {changes.length > 0 && (
              <ul className="rates-changes">
                {changes.map((step) => (
                  <li key={step.date}>
                    {show(step.date)}: {step.moveBp !== null && step.moveBp > 0 ? '+' : ''}
                    {String(step.moveBp ?? 0)} bp to {formatNumber(step.from, 2)}–
                    {formatNumber(step.to, 2)}%
                  </li>
                ))}
              </ul>
            )}
            <h4 className="rates-subhead">
              Next decisions · market odds, not forecasts (Polymarket)
            </h4>
            <NextMeetings now={now} />
          </div>
        </section>
      )}
      <p className="panel-footnote">
        Treasury: Daily Treasury Par Yield Curve Rates, U.S. Department of the Treasury. The SOFR
        and EFFR are subject to the Terms of Use posted at newyorkfed.org. The New York Fed is not
        responsible for publication of the SOFR and EFFR by Parallax, does not sanction or endorse
        any particular republication, and has no liability for your use.
      </p>
    </div>
  );
}
