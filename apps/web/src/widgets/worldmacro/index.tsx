import { geoEqualEarth, geoPath } from 'd3-geo';
import type { IDockviewPanelProps } from 'dockview-react';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { useMemo, useState } from 'react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import countries110m from 'world-atlas/countries-110m.json';
import '../../design/market.css';
import '../../design/panels.css';
import '../../design/worldmacro.css';
import { Cell } from '../../design/Cell';
import { formatCompact, formatNumber } from '../../design/format';
import { failureNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import { useReportSources } from '../../store/panels';
import { usePrefs } from '../../store/prefs';
import {
  largestEconomies,
  METRICS,
  quintiles,
  useWorld,
  type WorldCountry,
  type WorldMetric,
} from '../../store/world';
import { ISO3_BY_NUMERIC } from '../../store/worldIso';

const WIDTH = 640;
const HEIGHT = 312;

const topology = countries110m as unknown as Topology<{ countries: GeometryCollection }>;
const SHAPES = (
  feature(topology, topology.objects.countries) as unknown as FeatureCollection<
    Geometry,
    { name: string }
  >
).features;
const projection = geoEqualEarth().fitSize([WIDTH, HEIGHT], { type: 'Sphere' });
const toPath = geoPath(projection);
/** Every country's outline, drawn once: the map never moves. */
const OUTLINES: readonly { iso3: string | null; name: string; d: string }[] = SHAPES.map(
  (shape: Feature<Geometry, { name: string }>) => ({
    iso3: typeof shape.id === 'string' ? (ISO3_BY_NUMERIC[shape.id] ?? null) : null,
    name: shape.properties.name,
    d: toPath(shape) ?? '',
  }),
);
const SPHERE = toPath({ type: 'Sphere' }) ?? '';

function MetricValue({ value, metric }: { value: number | null; metric: WorldMetric }) {
  return <Cell value={value} decimals={1} suffix="%" signed={metric === 'growth'} />;
}

/** M8: IMF growth, inflation and debt on a map, and the 50 largest economies in a table. */
export default function WorldMacro({ api }: IDockviewPanelProps) {
  const world = useWorld();
  const simple = usePrefs((state) => state.mode === 'simple');
  const [metric, setMetric] = useState<WorldMetric>('growth');
  const [selected, setSelected] = useState<string | null>(null);
  useReportSources(api.id, ['imf', 'worldbank']);

  const byIso = useMemo(
    () => new Map((world.data?.countries ?? []).map((country) => [country.iso3, country])),
    [world.data],
  );
  const scale = useMemo(
    () =>
      quintiles(
        (world.data?.countries ?? []).flatMap((country) =>
          country[metric] === null ? [] : [country[metric] ?? 0],
        ),
      ),
    [world.data, metric],
  );
  const table = useMemo(() => largestEconomies(world.data?.countries ?? []), [world.data]);
  const current = METRICS.find((entry) => entry.id === metric) ?? METRICS[0];
  const chosen: WorldCountry | undefined = selected ? byIso.get(selected) : undefined;
  const year = world.data?.year ?? '';

  return (
    <div className="market-panel worldmacro-panel">
      <div className="worldmacro-toolbar" role="group" aria-label="Map shows">
        {METRICS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="chart-interval"
            aria-pressed={metric === entry.id}
            onClick={() => {
              setMetric(entry.id);
            }}
          >
            {simple ? entry.plain : entry.label}
          </button>
        ))}
      </div>
      {world.state === 'loading' && <p className="panel-empty">Loading IMF and World Bank…</p>}
      {world.failure && (
        <PanelNotice
          notice={failureNotice(world.failure, 'IMF and World Bank data')}
          compact={world.data !== null}
        />
      )}
      {world.data && (
        <>
          <figure className="worldmacro-map">
            <svg
              viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
              role="img"
              aria-label={`${current.label}, ${year}, by country`}
            >
              <path d={SPHERE} className="worldmacro-sphere" />
              {OUTLINES.map((outline, index) => {
                const country = outline.iso3 ? byIso.get(outline.iso3) : undefined;
                const value = country ? country[metric] : null;
                const step = scale.stepOf(value);
                return (
                  <path
                    key={`${outline.name}-${String(index)}`}
                    d={outline.d}
                    className="worldmacro-country"
                    data-step={step ?? 'none'}
                    aria-selected={outline.iso3 !== null && outline.iso3 === selected}
                    onClick={() => {
                      setSelected(outline.iso3);
                    }}
                  >
                    <title>
                      {country
                        ? `${country.name}: ${current.label.toLowerCase()} ${value === null ? 'not available' : `${formatNumber(value, 1)}${current.unit === '%' ? '%' : ` ${current.unit}`}`}`
                        : `${outline.name}: no data`}
                    </title>
                  </path>
                );
              })}
            </svg>
            <figcaption className="worldmacro-legend" data-term="Map shading">
              <span className="worldmacro-legend-title">
                {simple ? current.plain : current.label}, {year}
              </span>
              {[0, 1, 2, 3, 4].map((step) => {
                const low = step === 0 ? null : scale.edges[step - 1];
                const high = step === 4 ? null : scale.edges[step];
                return (
                  <span key={step} className="worldmacro-key">
                    <span className="worldmacro-swatch" data-step={step} />
                    {low === null
                      ? `under ${formatNumber(high ?? 0, 1)}`
                      : high === null
                        ? `${formatNumber(low, 1)}+`
                        : `${formatNumber(low, 1)}–${formatNumber(high, 1)}`}
                  </span>
                );
              })}
              <span className="worldmacro-key">
                <span className="worldmacro-swatch" data-step="none" />
                no data
              </span>
            </figcaption>
          </figure>
          {chosen && (
            <p className="worldmacro-chosen">
              <strong>{chosen.name}</strong>: growth{' '}
              {chosen.growth === null ? '—' : `${formatNumber(chosen.growth, 1, true)}%`}, inflation{' '}
              {chosen.inflation === null ? '—' : `${formatNumber(chosen.inflation, 1)}%`},
              government debt{' '}
              {chosen.debt === null ? '—' : `${formatNumber(chosen.debt, 1)}% of GDP`}
              {chosen.gdpUsd !== null &&
                `, GDP $${formatCompact(chosen.gdpUsd)} (${chosen.gdpYear ?? ''})`}
            </p>
          )}
          <div className="worldmacro-table">
            <div className="market-columns worldmacro-columns">
              <span>Country</span>
              <span>GDP</span>
              <span>Growth</span>
              <span>Inflation</span>
              <span>Debt</span>
            </div>
            <ul aria-label={`The ${String(table.length)} largest economies`}>
              {table.map((country) => (
                <li
                  key={country.iso3}
                  className="market-row worldmacro-columns"
                  aria-selected={country.iso3 === selected}
                  onClick={() => {
                    setSelected(country.iso3);
                  }}
                >
                  <span className="worldmacro-name" title={country.name}>
                    {country.name}
                  </span>
                  <span className="text-right font-mono">
                    {country.gdpUsd === null ? '—' : `$${formatCompact(country.gdpUsd)}`}
                  </span>
                  <MetricValue value={country.growth} metric="growth" />
                  <MetricValue value={country.inflation} metric="inflation" />
                  <MetricValue value={country.debt} metric="debt" />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      <p className="panel-footnote">
        Growth, inflation and government debt (% of GDP) for {year}: Source: International Monetary
        Fund, {world.data?.imfEdition ?? 'World Economic Outlook'}, estimates for the current year
        (imf.org/external/datamapper). GDP in current US dollars: World Bank, World Development
        Indicators (NY.GDP.MKTP.CD), latest year, licensed CC BY 4.0; shown rounded. Reuse is free
        with this credit under the{' '}
        <a href="https://www.imf.org/en/About/copyright-and-terms" target="_blank" rel="noreferrer">
          IMF&apos;s terms
        </a>{' '}
        and{' '}
        <a
          href="https://datacatalog.worldbank.org/public-licenses"
          target="_blank"
          rel="noreferrer"
        >
          the World Bank&apos;s
        </a>
        . Map: made with Natural Earth. Yearly figures, cached a day.
      </p>
    </div>
  );
}
