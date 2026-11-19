import type { IDockviewPanelProps } from 'dockview-react';
import '../../design/energy.css';
import '../../design/market.css';
import '../../design/panels.css';
import { Cell } from '../../design/Cell';
import { failureNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import {
  energyStat,
  PRICE_ROWS,
  STOCK_ROWS,
  SUPPLY_ROWS,
  useEnergy,
  type EnergyMap,
  type EnergyRow,
} from '../../store/energy';
import { useReportSources } from '../../store/panels';
import { usePrefs } from '../../store/prefs';

function Row({
  row,
  series,
  simple,
  norm,
}: {
  row: EnergyRow;
  series: EnergyMap;
  simple: boolean;
  /** Weekly rows compare the week's change with the five-year norm; spot prices do not. */
  norm: boolean;
}) {
  const stat = energyStat(series[row.id]);
  const scaled = (value: number | undefined) =>
    value === undefined ? undefined : value / row.scale;
  const price = row.unit.startsWith('$');
  const tone =
    price && stat?.change !== undefined && stat.change !== 0
      ? stat.change > 0
        ? 'up'
        : 'down'
      : 'neutral';
  const label = simple ? row.plain : row.label;
  return (
    <li className="market-row energy-columns" title={series[row.id]?.description}>
      <span className="energy-label" data-term={row.label}>
        <span className="energy-name" title={label}>
          {label}
        </span>
        <span className="energy-unit">{row.unit}</span>
      </span>
      <span className="energy-metric">
        <span className="energy-metric-label">Latest</span>
        <Cell value={scaled(stat?.value)} decimals={row.decimals} />
      </span>
      <span className="energy-metric">
        <span className="energy-metric-label">Week</span>
        <Cell value={scaled(stat?.change)} decimals={row.decimals} signed tone={tone} />
      </span>
      {norm ? (
        <span
          className="energy-metric"
          title={
            stat && stat.normYears > 0
              ? `Against the average change in the same week of the previous ${String(stat.normYears)} years`
              : 'Not enough earlier years on record'
          }
        >
          <span className="energy-metric-label">vs 5-yr</span>
          <Cell value={scaled(stat?.vsNorm)} decimals={row.decimals} signed />
        </span>
      ) : (
        <span
          className="energy-metric energy-not-applicable"
          title="Seasonal comparison does not apply to spot prices"
        >
          <span className="energy-metric-label">vs 5-yr</span>
          <span>—</span>
        </span>
      )}
      <span className="energy-metric energy-asof font-mono">
        <span className="energy-metric-label">As of</span>
        <span>{stat?.asOf.slice(5) ?? ''}</span>
      </span>
    </li>
  );
}

function Group({
  title,
  term,
  rows,
  series,
  simple,
  norm,
}: {
  title: string;
  term: string;
  rows: readonly EnergyRow[];
  series: EnergyMap;
  simple: boolean;
  norm: boolean;
}) {
  return (
    <section className="energy-group" aria-label={title}>
      <h3 className="markets-group" data-term={term}>
        {title}
      </h3>
      <ul>
        {rows.map((row) => (
          <Row key={row.id} row={row} series={series} simple={simple} norm={norm} />
        ))}
      </ul>
    </section>
  );
}

/** M4: US oil and gas storage, supply and spot prices from EIA's weekly reports, via the edge. */
export default function Energy({ api }: IDockviewPanelProps) {
  const energy = useEnergy();
  const simple = usePrefs((state) => state.mode === 'simple');
  useReportSources(api.id, ['eia']);

  return (
    <div className="market-panel energy-panel">
      <p className="energy-context">
        <span className="energy-context-label">U.S. energy</span>
        <span>Storage · supply · spot prices</span>
      </p>
      <p className="energy-comparison">
        <span className="energy-comparison-label">vs 5-yr</span>
        <span>seasonal norm, not a forecast</span>
      </p>
      <div className="market-columns energy-columns">
        <span>Measure</span>
        <span>Latest</span>
        <span>Week</span>
        <span>vs 5-yr</span>
        <span>As of</span>
      </div>
      {energy.state === 'loading' && <p className="panel-empty">Loading EIA…</p>}
      {energy.failure && (
        <PanelNotice
          notice={failureNotice(energy.failure, 'EIA')}
          compact={energy.state === 'ready'}
        />
      )}
      {energy.state === 'ready' && (
        <>
          <Group
            title={simple ? 'In storage' : 'Stocks'}
            term="Stocks"
            rows={STOCK_ROWS}
            series={energy.series}
            simple={simple}
            norm
          />
          <Group
            title="Supply"
            term="Supply"
            rows={SUPPLY_ROWS}
            series={energy.series}
            simple={simple}
            norm
          />
          <Group
            title={simple ? 'Prices' : 'Spot prices'}
            term="Spot prices"
            rows={PRICE_ROWS}
            series={energy.series}
            simple={simple}
            norm={false}
          />
        </>
      )}
      <p className="panel-footnote">
        Source: U.S. Energy Information Administration (EIA), Weekly Petroleum Status Report and
        Weekly Natural Gas Storage Report; spot prices daily. Via the edge, refreshed hourly.
        &quot;Week&quot; is the change from the week before (spot prices: the day before); &quot;vs
        5-yr&quot; compares it with the average change in the same week of the five previous years,
        a seasonal norm, not analysts&apos; forecasts.
      </p>
    </div>
  );
}
