import type { IDockviewPanelProps } from 'dockview-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cell } from '../../design/Cell';
import '../../design/globe.css';
import '../../design/market.css';
import { availabilityNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import { useSharedAvailability } from '../../store/availability';
import { usePriceLine, useServingSource } from '../../store/hooks';
import { useReportSources } from '../../store/panels';
import { market, sessionState } from '../../store/sessions';
import { instrument, type Instrument } from '../../store/symbols';
import { PROXY_LABEL } from '../regionBoards';
import { useNow } from '../useNow';
import type * as DrawModule from './draw';
import type { Palette } from './draw';
import {
  biggestMoves,
  COUNTRY_PROXIES,
  dragged,
  EXCHANGES,
  openingView,
  VIEWS,
  type LonLat,
} from './model';

interface GlobeParams {
  centre?: [number, number];
}

/** The drawing module: imported on first open, so d3-geo and the map stay out of the main bundle. */
type Drawing = typeof DrawModule;

/** The sun moves a quarter degree a minute: redraw the night side once a minute. */
const SUN_REFRESH_MS = 60_000;

function readPalette(): Palette {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    theme: root.dataset.theme === 'light' ? 'light' : 'dark',
    bg: token('--bg'),
    line: token('--line'),
    text: token('--text'),
    muted: token('--muted'),
    live: token('--live'),
    up: token('--up'),
    down: token('--down'),
    font: token('--font-num'),
  };
}

const isLonLat = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((part) => typeof part === 'number' && Number.isFinite(part));

/** Keeps one country ETF's day change flowing into the globe; renders nothing. */
const MoveProbe = memo(function MoveProbe({
  item,
  onChange,
}: {
  item: Instrument;
  onChange: (id: string, changePct: number | undefined, source: string | undefined) => void;
}) {
  const line = usePriceLine(item);
  const source = useServingSource(item.id);
  useEffect(() => {
    onChange(item.id, line.changePct, source);
  }, [item.id, line.changePct, source, onChange]);
  return null;
});

/** F3: a 3D globe with the day/night line, open exchanges lit and arcs for the biggest moves. */
export default function Globe({ api, params }: IDockviewPanelProps<GlobeParams>) {
  const now = useNow(SUN_REFRESH_MS);
  const open = useMemo(
    () =>
      new Set(
        EXCHANGES.flatMap(({ session }) => {
          const exchange = market(session);
          return exchange && sessionState(exchange, now).open ? [session] : [];
        }),
      ),
    [now],
  );

  const proxies = useMemo(
    () => COUNTRY_PROXIES.flatMap((country) => instrument(country.proxy) ?? []),
    [],
  );
  const shared = useSharedAvailability(proxies);
  const keyNotice = useMemo(
    () => (shared ? availabilityNotice(shared, 'the biggest moves') : null),
    [shared],
  );
  const [changes, setChanges] = useState<Record<string, number | undefined>>({});
  const [sources, setSources] = useState<Record<string, string>>({});
  const onChange = useCallback(
    (id: string, changePct: number | undefined, source: string | undefined) => {
      setChanges((current) =>
        current[id] === changePct ? current : { ...current, [id]: changePct },
      );
      setSources((current) => {
        if (current[id] === source) return current;
        const others = Object.entries(current).filter(([key]) => key !== id);
        return Object.fromEntries(source === undefined ? others : [...others, [id, source]]);
      });
    },
    [],
  );
  useReportSources(api.id, Object.values(sources));
  const moves = useMemo(() => biggestMoves(changes), [changes]);

  // The view: saved with the panel, else wherever exchanges are open on first paint.
  const [centre, setCentre] = useState<LonLat>(() =>
    isLonLat(params.centre) ? params.centre : openingView(open, -new Date().getTimezoneOffset()),
  );
  const keep = useCallback(
    (next: LonLat) => {
      api.updateParameters({ ...params, centre: [next[0], next[1]] });
    },
    [api, params],
  );

  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    import('./draw').then(
      (module) => {
        if (live) setDrawing(module);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((current) =>
        current.width === Math.round(width) && current.height === Math.round(height)
          ? current
          : { width: Math.round(width), height: Math.round(height) },
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const [palette, setPalette] = useState<Palette>(readPalette);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setPalette(readPalette());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-palette'],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  // One paint per frame at most, whatever changed.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !drawing || size.width === 0 || size.height === 0) return;
    const frame = requestAnimationFrame(() => {
      const ratio = window.devicePixelRatio || 1;
      if (element.width !== size.width * ratio) element.width = size.width * ratio;
      if (element.height !== size.height * ratio) element.height = size.height * ratio;
      const context = element.getContext('2d');
      if (!context) return;
      drawing.drawGlobe(context, { ...size, ratio, centre, now, open, moves }, palette);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [drawing, palette, size, centre, now, open, moves]);

  // Drag to turn: the globe follows the pointer and stays where it is let go. No inertia.
  const drag = useRef<{ x: number; y: number; from: LonLat } | null>(null);
  const radius = drawing ? drawing.radiusFor(size.width, size.height) : 1;

  const openNames = EXCHANGES.filter((exchange) => open.has(exchange.session)).map(
    (exchange) => exchange.city,
  );

  return (
    <div className="market-panel globe-panel">
      <div className="panel-toolbar globe-toolbar">
        <span className="panel-heading">World · day and night</span>
        <span className="globe-views" role="group" aria-label="Turn the globe to">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              className="chart-interval"
              onClick={() => {
                setCentre(view.centre);
                keep(view.centre);
              }}
            >
              {view.label}
            </button>
          ))}
        </span>
      </div>
      <div className="globe-stage">
        <canvas
          ref={canvas}
          className="globe-canvas"
          role="img"
          aria-label={`Globe. Open now: ${openNames.length > 0 ? openNames.join(', ') : 'no exchange'}.${
            moves.length > 0
              ? ` Biggest moves: ${moves
                  .map((move) => `${move.country} ${move.changePct.toFixed(2)}%`)
                  .join(', ')}.`
              : ''
          }`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, from: centre };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            setCentre(
              dragged(start.from, event.clientX - start.x, event.clientY - start.y, radius),
            );
          }}
          onPointerUp={() => {
            if (drag.current) keep(centre);
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
        {!drawing && (
          <p className="market-empty chart-empty">
            {failed ? 'The globe could not load.' : 'Loading the globe…'}
          </p>
        )}
      </div>
      <dl className="globe-legend">
        <div className="globe-open-markets">
          <dt data-term="Open now">Open now</dt>
          <dd>
            {openNames.length > 0 ? openNames.join(' · ') : 'No exchange; crypto never closes'}
          </dd>
        </div>
        <div>
          <dt data-term="Biggest moves">Biggest moves</dt>
          <dd>
            {moves.length === 0 ? (
              <span className="text-muted">Waiting for the country ETFs</span>
            ) : (
              moves.map((move) => (
                <span key={move.proxy} className="globe-move">
                  {move.country}
                  <Cell
                    value={move.changePct}
                    decimals={2}
                    signed
                    suffix="%"
                    tone={move.changePct > 0 ? 'up' : move.changePct < 0 ? 'down' : 'neutral'}
                  />
                  <span className="globe-proxy">
                    {move.proxy}, {PROXY_LABEL}
                  </span>
                </span>
              ))
            )}
          </dd>
        </div>
      </dl>
      {keyNotice && <PanelNotice notice={keyNotice} compact />}
      {proxies.map((item) => (
        <MoveProbe key={item.id} item={item} onChange={onChange} />
      ))}
      <p className="panel-footnote">
        Night is shaded from the sun&apos;s position; exchange hours come from the session model
        (holidays not modelled). Arcs run from New York, where these US-listed country ETFs trade,
        to the three whose price moved most since the previous close: proxies, not official index
        levels. Made with Natural Earth.
      </p>
    </div>
  );
}
