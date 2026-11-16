import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import '../../design/panels.css';
import { CONSTELLATION_SAMPLES, MIN_PAIRS, skyAt, type Sky } from '../../store/constellation';
import { usePriceSubscriptions } from '../../store/hooks';
import { useKeyVault } from '../../store/keys';
import { linkGroupOf, selectLinked, useLinkStore } from '../../store/links';
import { instruments, type Instrument } from '../../store/symbols';
import { useTickStore } from '../../store/ticks';
import { placeBodies, stepBodies, type Body } from './layout';
import { DEFAULT_SYMBOLS, EQUITY_SYMBOLS } from './meta';

interface ConstellationParams {
  symbols?: string[];
  link?: number;
}

const REFRESH_MS = 5_000;
const SETTLED = 0.01;
const SETTLE_STEPS = 400;
const MIN_RADIUS = 8;
const MAX_RADIUS = 26;
const FX_RADIUS = 12;
const EDGE_MIN = 0.5;

interface Palette {
  text: string;
  muted: string;
  up: string;
  down: string;
  live: string;
  font: string;
}

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    text: token('--text'),
    muted: token('--muted'),
    up: token('--up'),
    down: token('--down'),
    live: token('--live'),
    font: token('--font-num'),
  };
}

function radiiFor(sky: Sky): number[] {
  const largest = Math.max(0, ...sky.stars.map((star) => star.value ?? 0));
  return sky.stars.map((star) =>
    star.value === undefined || largest === 0
      ? FX_RADIUS
      : MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(star.value / largest),
  );
}

function formatChange(change: number | undefined): string {
  if (change === undefined) return 'no move yet';
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}

function draw(
  canvas: HTMLCanvasElement,
  bodies: readonly Body[],
  sky: Sky,
  items: readonly Instrument[],
  selected: string | undefined,
  palette: Palette,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const scale = window.devicePixelRatio || 1;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, canvas.width / scale, canvas.height / scale);
  const largestMove = Math.max(0.05, ...sky.stars.map((star) => Math.abs(star.change ?? 0)));

  // Links between strongly co-moving pairs; dashed when they move against each other.
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const c = sky.correlations[i]?.[j];
      const a = bodies[i];
      const b = bodies[j];
      if (c === undefined || Math.abs(c) < EDGE_MIN || !a || !b) continue;
      context.globalAlpha = Math.min(0.6, (Math.abs(c) - EDGE_MIN) * 1.2);
      context.strokeStyle = palette.muted;
      context.lineWidth = 1;
      context.setLineDash(c < 0 ? [3, 3] : []);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }
  context.setLineDash([]);

  bodies.forEach((body, index) => {
    const star = sky.stars[index];
    const change = star?.change;
    const color =
      change === undefined || change === 0 ? palette.muted : change > 0 ? palette.up : palette.down;
    context.globalAlpha =
      change === undefined ? 0.35 : 0.35 + 0.65 * Math.min(1, Math.abs(change) / largestMove);
    context.fillStyle = color;
    context.beginPath();
    context.arc(body.x, body.y, body.r, 0, 2 * Math.PI);
    context.fill();
    context.globalAlpha = 1;
    if (body.id === selected) {
      context.strokeStyle = palette.live;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(body.x, body.y, body.r + 4, 0, 2 * Math.PI);
      context.stroke();
    }
    context.fillStyle = palette.text;
    context.font = `10px ${palette.font}`;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(items[index]?.label ?? body.id, body.x, body.y + body.r + 3);
  });
}

/**
 * A living map: each instrument is a body sized by traded value and coloured by its move over
 * the last 15 minutes; bodies drift together when their prices move together. Click a body to
 * send it to every panel in this panel's link group.
 */
export default function Constellation({ params }: IDockviewPanelProps<ConstellationParams>) {
  const stocks = useKeyVault(
    (state) => state.keys.alpaca !== undefined || state.keys.finnhub !== undefined,
  );
  // An empty list (opened from the command bar without symbols) means the default sky.
  const ids =
    params.symbols && params.symbols.length > 0
      ? params.symbols
      : stocks
        ? [...DEFAULT_SYMBOLS, ...EQUITY_SYMBOLS]
        : DEFAULT_SYMBOLS;
  const idsKey = ids.join(',');
  const items = useMemo(() => instruments(idsKey.split(',')), [idsKey]);
  usePriceSubscriptions(items);
  const link = linkGroupOf(params);
  const selected = useLinkStore((state) => (link === undefined ? undefined : state.symbols[link]));
  const cursor = useTickStore((state) => state.cursor);

  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const bodies = useRef<Body[]>([]);
  const size = useRef({ width: 0, height: 0 });
  const [sky, setSky] = useState<Sky>(() => skyAt(items, Date.now(), null));
  const [hover, setHover] = useState<number | undefined>(undefined);

  // Refresh the model every 5 s, and whenever Rewind moves.
  useEffect(() => {
    const update = () => {
      setSky(skyAt(items, cursor ?? Date.now(), cursor));
    };
    update();
    const timer = window.setInterval(update, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [items, cursor]);

  // Keep the canvas at the panel's size, in device pixels.
  useEffect(() => {
    const element = frame.current;
    const target = canvas.current;
    if (!element || !target) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      size.current = { width, height };
      const scale = window.devicePixelRatio || 1;
      target.width = Math.round(width * scale);
      target.height = Math.round(height * scale);
      target.style.width = `${String(width)}px`;
      target.style.height = `${String(height)}px`;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Run the layout until it settles; with reduced motion, settle at once and draw one frame.
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const { width, height } = size.current;
    const radii = radiiFor(sky);
    const known = new Map(bodies.current.map((body) => [body.id, body]));
    const fresh = placeBodies(
      items.map((item) => item.id),
      radii,
      width || 400,
      height || 300,
    );
    bodies.current = fresh.map((body, index) => {
      const previous = known.get(body.id);
      return previous ? { ...previous, r: radii[index] ?? previous.r } : body;
    });
    const correlationOf = (i: number, j: number) => sky.correlations[i]?.[j];
    const palette = readPalette();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let handle = 0;
    const tick = () => {
      const { width: w, height: h } = size.current;
      if (w === 0 || h === 0) {
        handle = window.requestAnimationFrame(tick);
        return;
      }
      if (reduced) {
        for (let step = 0; step < SETTLE_STEPS; step += 1)
          stepBodies(bodies.current, correlationOf, w, h);
        draw(target, bodies.current, sky, items, selected, palette);
        return;
      }
      const energy = stepBodies(bodies.current, correlationOf, w, h);
      draw(target, bodies.current, sky, items, selected, palette);
      if (energy > SETTLED) handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(handle);
    };
  }, [sky, items, selected]);

  const hit = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const index = bodies.current.findIndex(
      (body) => Math.hypot(body.x - x, body.y - y) <= body.r + 4,
    );
    return index === -1 ? undefined : index;
  };

  const hovered = hover === undefined ? undefined : items[hover];
  const hoveredStar = hover === undefined ? undefined : sky.stars[hover];
  const gathering = sky.samples < MIN_PAIRS;

  return (
    <div className="constellation-panel">
      <div ref={frame} className="constellation-sky">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Constellation of ${String(items.length)} instruments. Bodies near each other have moved together over the last 15 minutes.`}
          className={link === undefined ? undefined : 'is-linkable'}
          onPointerMove={(event) => {
            setHover(hit(event));
          }}
          onPointerLeave={() => {
            setHover(undefined);
          }}
          onClick={(event) => {
            const index = hit(event);
            const item = index === undefined ? undefined : items[index];
            if (item) selectLinked(link, item.id);
          }}
        />
        {hovered && (
          <p className="constellation-tip">
            <strong>{hovered.label}</strong> {formatChange(hoveredStar?.change)}
            <span>{hovered.name}</span>
          </p>
        )}
        {gathering && (
          <p className="constellation-gathering">
            Gathering prices: correlations appear after {String(MIN_PAIRS)} five-second samples (
            {String(sky.samples)} so far).
          </p>
        )}
      </div>
      <ul className="sr-only" aria-label="Constellation instruments">
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => {
                selectLinked(link, item.id);
              }}
            >
              {item.label}: {formatChange(sky.stars[index]?.change)} over 15 minutes
            </button>
          </li>
        ))}
      </ul>
      <p className="panel-footnote">
        15-minute window, {String(CONSTELLATION_SAMPLES)} samples · size: traded value · colour:
        move
        {link === undefined ? ' · link this panel to send clicks to other panels' : ''}
      </p>
    </div>
  );
}
