import '../../design/panels.css';
import { Cell } from '../../design/Cell';
import {
  CURVE,
  daysBefore,
  latest,
  monthlyChange,
  useFred,
  valueOn,
  yearOnYear,
  type FredState,
  type Stat,
} from '../../store/macro';

const CURVE_IDS = CURVE.map(([, id]) => id);
const STAT_IDS = ['DFF', 'UNRATE', 'CPIAUCSL', 'PAYEMS'];
const WIDTH = 300;
const HEIGHT = 120;
const PAD = 16;

/** The yield curve today and a month ago. */
function YieldCurve({ fred }: { fred: FredState }) {
  const points = CURVE.map(([label, id]) => {
    const observations = fred.series[id] ?? [];
    const now = observations.at(-1);
    const monthAgo = now ? valueOn(observations, daysBefore(now.date, 30)) : undefined;
    return { label, now: now?.value, monthAgo: monthAgo?.value, asOf: now?.date };
  });
  const values = points
    .flatMap((point) => [point.now, point.monthAgo])
    .filter((v) => v !== undefined);
  if (values.length === 0) return null;
  const low = Math.floor(Math.min(...values) * 4) / 4;
  const high = Math.ceil(Math.max(...values) * 4) / 4 || low + 1;
  const x = (index: number) => PAD + (index * (WIDTH - 2 * PAD)) / (points.length - 1);
  const y = (value: number) =>
    HEIGHT - PAD - ((value - low) / (high - low || 1)) * (HEIGHT - 2 * PAD);
  const line = (key: 'now' | 'monthAgo') =>
    points
      .flatMap((point, index) =>
        point[key] === undefined ? [] : [`${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`],
      )
      .join(' ');
  const asOf = points.find((point) => point.asOf)?.asOf;

  return (
    <figure className="macro-curve">
      <figcaption>
        <span>US Treasury yield curve</span>
        <span className="panel-caption">{asOf ? `as of ${asOf}` : ''}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT + 14)}`}
        role="img"
        aria-label={`Treasury yields: ${points.map((p) => `${p.label} ${p.now?.toFixed(2) ?? 'n/a'}%`).join(', ')}`}
      >
        <line x1={PAD} x2={WIDTH - PAD} y1={y(low)} y2={y(low)} className="macro-axis" />
        <text x={2} y={y(high) + 4} className="macro-tick">
          {high.toFixed(2)}
        </text>
        <text x={2} y={y(low) + 4} className="macro-tick">
          {low.toFixed(2)}
        </text>
        <polyline points={line('monthAgo')} className="macro-line macro-line--then" />
        <polyline points={line('now')} className="macro-line" />
        {points.map((point, index) => (
          <text
            key={point.label}
            x={x(index)}
            y={HEIGHT + 10}
            textAnchor="middle"
            className="macro-tick"
          >
            {point.label}
          </text>
        ))}
      </svg>
      <p className="macro-legend">
        <span className="macro-key" /> latest <span className="macro-key macro-key--then" /> a month
        earlier
      </p>
    </figure>
  );
}

function StatRow({
  label,
  stat,
  decimals,
  suffix,
  signed = false,
  note,
}: {
  label: string;
  stat: Stat | undefined;
  decimals: number;
  suffix: string;
  signed?: boolean;
  note?: string;
}) {
  return (
    <li className="macro-stat">
      <span className="macro-label" title={note}>
        {label}
      </span>
      <Cell value={stat?.value} decimals={decimals} suffix={suffix} signed={signed} />
      <Cell value={stat?.change} decimals={decimals} signed className="text-muted" />
      <span className="macro-asof">{stat?.asOf ?? ''}</span>
    </li>
  );
}

/** Yield curve, policy rate, inflation and jobs from FRED, through the edge. */
export default function Macro() {
  const today = new Date().toISOString().slice(0, 10);
  const curve = useFred(CURVE_IDS, daysBefore(today, 45));
  const stats = useFred(STAT_IDS, daysBefore(today, 800));
  const ten = latest(curve.series.DGS10);
  const two = latest(curve.series.DGS2);
  const spread: Stat | undefined =
    ten && two ? { value: ten.value - two.value, change: undefined, asOf: ten.asOf } : undefined;

  if (curve.unconfigured || stats.unconfigured) {
    return (
      <div className="macro-panel">
        <p className="panel-empty" role="alert">
          FRED is not connected yet: the edge needs the project&apos;s FRED key (FRED_API_KEY).
        </p>
      </div>
    );
  }

  return (
    <div className="macro-panel">
      {curve.state === 'loading' && <p className="panel-empty">Loading FRED…</p>}
      {curve.state === 'error' && (
        <p className="panel-empty" role="alert">
          FRED is unavailable: {curve.error}
        </p>
      )}
      {curve.state === 'ready' && <YieldCurve fred={curve} />}
      <ul className="macro-stats" aria-label="Macro indicators">
        <li className="macro-stat macro-stat--head">
          <span>Indicator</span>
          <span>Latest</span>
          <span>Change</span>
          <span>As of</span>
        </li>
        <StatRow
          label="Fed funds (effective)"
          stat={latest(stats.series.DFF)}
          decimals={2}
          suffix="%"
        />
        <StatRow label="10Y − 2Y spread" stat={spread} decimals={2} suffix="pp" signed />
        <StatRow
          label="CPI inflation, YoY"
          stat={yearOnYear(stats.series.CPIAUCSL)}
          decimals={1}
          suffix="%"
          note="All items CPI, seasonally adjusted, against the same month a year earlier"
        />
        <StatRow
          label="Unemployment rate"
          stat={latest(stats.series.UNRATE)}
          decimals={1}
          suffix="%"
        />
        <StatRow
          label="Payrolls, monthly change"
          stat={monthlyChange(stats.series.PAYEMS)}
          decimals={0}
          suffix="k"
          signed
          note="Nonfarm payrolls, thousands of jobs added in the latest month"
        />
      </ul>
      <p className="panel-footnote">
        FRED via the edge · official data, daily or monthly; refreshed hourly
      </p>
    </div>
  );
}
