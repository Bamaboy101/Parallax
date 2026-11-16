import type { IDockviewPanelProps } from 'dockview-react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  TickMarkType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import '../../design/market.css';
import type { Bar, BarInterval } from '../../feeds/types';
import { INTERVALS, useCandles } from '../../store/candles';
import { useTick } from '../../store/hooks';
import { useReportSources } from '../../store/panels';
import { instrument } from '../../store/symbols';
import { DEFAULT_INTERVAL, DEFAULT_SYMBOL } from './meta';

interface ChartParams {
  symbol?: string;
  interval?: string;
}

const isInterval = (value: unknown): value is BarInterval =>
  typeof value === 'string' && (INTERVALS as readonly string[]).includes(value);

/** Canvas needs concrete colours; read the design tokens from CSS. */
function palette() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    panel: token('--panel'),
    line: token('--line'),
    muted: token('--muted'),
    up: token('--up'),
    down: token('--down'),
    live: token('--live'),
  };
}

/** '#rrggbb' + alpha → 'rgba(...)', for volume bars under the candles. */
function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  const [, r = '0', g = '0', b = '0'] = match;
  return `rgba(${String(parseInt(r, 16))}, ${String(parseInt(g, 16))}, ${String(parseInt(b, 16))}, ${String(alpha)})`;
}

const toTime = (ts: number) => (ts / 1000) as UTCTimestamp;
const fromTime = (time: Time) => (typeof time === 'number' ? time * 1000 : 0);

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dayOfYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const year = new Intl.DateTimeFormat(undefined, { year: 'numeric' });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Axis labels by tick kind: the year at a year boundary, the date at a day, else the time. */
function tickLabel(time: Time, kind: TickMarkType): string {
  const at = fromTime(time);
  if (kind === TickMarkType.Year) return year.format(at);
  if (kind === TickMarkType.Month || kind === TickMarkType.DayOfMonth) return dayOfYear.format(at);
  return timeOfDay.format(at);
}

interface Handles {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
}

function applyTheme({ chart, candles, volume }: Handles): void {
  const colors = palette();
  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: colors.panel },
      textColor: colors.muted,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-num'),
      // Lightweight Charts is Apache-2.0 and asks for a link to TradingView; the logo provides it.
      attributionLogo: true,
    },
    grid: {
      vertLines: { color: withAlpha(colors.line, 0.25) },
      horzLines: { color: withAlpha(colors.line, 0.45) },
    },
    rightPriceScale: { borderColor: colors.line },
    timeScale: { borderColor: colors.line },
    crosshair: {
      vertLine: { color: colors.muted, labelBackgroundColor: colors.line },
      horzLine: { color: colors.muted, labelBackgroundColor: colors.line },
    },
  });
  candles.applyOptions({
    upColor: colors.up,
    downColor: colors.down,
    wickUpColor: colors.up,
    wickDownColor: colors.down,
    borderVisible: false,
  });
  // Volume colours are baked into each point, so repaint the bars already drawn.
  const rising = new Map(
    candles.data().map((point) => [point.time, 'close' in point && point.close >= point.open]),
  );
  volume.setData(
    volume.data().map((point) =>
      'value' in point
        ? {
            ...point,
            color: withAlpha(rising.get(point.time) ? colors.up : colors.down, 0.35),
          }
        : point,
    ),
  );
}

function volumePoint(bar: Bar) {
  const colors = palette();
  return {
    time: toTime(bar.ts),
    value: bar.volume,
    color: withAlpha(bar.close >= bar.open ? colors.up : colors.down, 0.35),
  };
}

const candlePoint = (bar: Bar) => ({
  time: toTime(bar.ts),
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close,
});

/** Candles with volume: REST history, the live last bar from the stream, timeframe switch. */
export default function Chart({ api, params }: IDockviewPanelProps<ChartParams>) {
  const item = instrument(params.symbol ?? DEFAULT_SYMBOL) ?? instrument(DEFAULT_SYMBOL);
  if (!item) throw new Error('default chart symbol missing from the catalog');
  const interval = isInterval(params.interval) ? params.interval : DEFAULT_INTERVAL;
  const candles = useCandles(item, interval);
  const source = useTick(item, 'bar')?.source;
  useReportSources(api.id, source ? [source] : []);

  const container = useRef<HTMLDivElement>(null);
  const handles = useRef<Handles | null>(null);

  // Create the chart once; follow theme and palette switches.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = createChart(element, {
      autoSize: true,
      localization: { timeFormatter: (time: Time) => full.format(fromTime(time)) },
      timeScale: { rightOffset: 4, secondsVisible: false, tickMarkFormatter: tickLabel },
    });
    const created: Handles = {
      chart,
      candles: chart.addSeries(CandlestickSeries),
      volume: chart.addSeries(HistogramSeries, {
        priceScaleId: '',
        priceFormat: { type: 'volume' },
      }),
    };
    created.volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    created.candles.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });
    applyTheme(created);
    handles.current = created;
    const observer = new MutationObserver(() => {
      applyTheme(created);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-palette'],
    });
    return () => {
      observer.disconnect();
      handles.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const step = 10 ** -item.decimals;
    handles.current?.candles.applyOptions({
      priceFormat: { type: 'price', precision: item.decimals, minMove: step },
    });
  }, [item.decimals]);

  // Full redraw when history (re)loads, the symbol or the interval changes.
  const { history, tail } = candles;
  /** Open time of the newest bar on the chart; the library rejects updates older than it. */
  const newest = useRef(0);
  useEffect(() => {
    const current = handles.current;
    if (!current) return;
    const bars = [...history, ...tail.filter((bar) => bar.ts > (history.at(-1)?.ts ?? 0))];
    current.candles.setData(bars.map(candlePoint));
    current.volume.setData(bars.map(volumePoint));
    newest.current = bars.at(-1)?.ts ?? 0;
    // `tail` is read once here; later live bars arrive through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  // Live last bar(s). Bars older than the chart's newest are already drawn from history.
  useEffect(() => {
    const current = handles.current;
    if (!current) return;
    for (const bar of tail) {
      if (bar.ts < newest.current) continue;
      current.candles.update(candlePoint(bar));
      current.volume.update(volumePoint(bar));
      newest.current = bar.ts;
    }
  }, [tail]);

  return (
    <div className="market-panel chart-panel">
      <div className="market-toolbar chart-toolbar">
        <span className="market-symbol">{item.label}</span>
        <div className="chart-intervals" role="group" aria-label="Chart interval">
          {INTERVALS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === interval}
              onClick={() => {
                api.updateParameters({ ...params, interval: option });
              }}
              className="chart-interval"
            >
              {option}
            </button>
          ))}
        </div>
        {candles.state === 'error' && (
          <span className="ml-auto text-label text-warn" title={candles.error}>
            History unavailable
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={container} className="absolute inset-0" />
        {candles.state === 'loading' && history.length === 0 && (
          <p className="market-empty chart-empty">Loading history…</p>
        )}
      </div>
    </div>
  );
}
