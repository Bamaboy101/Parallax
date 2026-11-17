import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCompact } from '../../design/format';
import { availabilityNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import { useSharedAvailability } from '../../store/availability';
import { CONSTELLATION_SAMPLES, MIN_PAIRS, skyAt, type Sky } from '../../store/constellation';
import { usePriceSubscriptions } from '../../store/hooks';
import { useKeyVault } from '../../store/keys';
import { linkGroupOf, selectLinked, useLinkStore } from '../../store/links';
import { instruments, type Instrument } from '../../store/symbols';
import { useTickStore } from '../../store/ticks';
import { perpFor, useLiquidationFeeds, WHALE_FLOOR } from '../../store/whales';
import { placeBodies, stepBodies, type Body } from './layout';
import { DEFAULT_SYMBOLS, EQUITY_SYMBOLS } from './meta';

/** F8: the whale count in words, for the tooltip and the screen-reader list. */
const whalesText = (count: number): string =>
  count === 0 ? '' : ` · ${String(count)} whale ${count === 1 ? 'print' : 'prints'} in 15 min`;

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
const EDGE_MIN = 0.65;
const LAYOUT_MOTION_MS = 160;

interface Palette {
  text: string;
  muted: string;
  panel: string;
  line: string;
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
    panel: token('--panel'),
    line: token('--line'),
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

interface Label {
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Place ink, never physics: stable priority, nearest clear rectangle, no clipped labels. */
function placeLabels(
  context: CanvasRenderingContext2D,
  bodies: readonly Body[],
  items: readonly Instrument[],
  selected: string | undefined,
  width: number,
  height: number,
): Label[] {
  const labels: Label[] = [];
  const margin = 8;
  const labelHeight = 18;
  const order = bodies
    .map((body, index) => ({ body, index }))
    .sort((a, b) => {
      if (a.body.id === selected) return -1;
      if (b.body.id === selected) return 1;
      return a.body.id < b.body.id ? -1 : a.body.id > b.body.id ? 1 : a.index - b.index;
    });
  for (const { body, index } of order) {
    const text = items[index]?.label ?? body.id;
    const labelWidth = Math.ceil(context.measureText(text).width) + 12;
    if (labelWidth + margin * 2 > width || labelHeight + margin * 2 > height) continue;
    let best: Label | undefined;
    let bestDistance = Infinity;
    const consider = (x: number, y: number) => {
      if (
        x < margin ||
        y < margin ||
        x + labelWidth > width - margin ||
        y + labelHeight > height - margin
      )
        return;
      const distance = (x + labelWidth / 2 - body.x) ** 2 + (y + labelHeight / 2 - body.y) ** 2;
      if (distance >= bestDistance) return;
      if (
        labels.some(
          (label) =>
            x < label.x + label.width + 3 &&
            x + labelWidth + 3 > label.x &&
            y < label.y + label.height + 3 &&
            y + labelHeight + 3 > label.y,
        )
      )
        return;
      if (
        bodies.some((other) => {
          const dx = other.x - Math.max(x, Math.min(other.x, x + labelWidth));
          const dy = other.y - Math.max(y, Math.min(other.y, y + labelHeight));
          return dx * dx + dy * dy < (other.r + 6) ** 2;
        })
      )
        return;
      best = { index, text, x, y, width: labelWidth, height: labelHeight };
      bestDistance = distance;
    };
    const gap = body.r + 8;
    consider(body.x - labelWidth / 2, body.y + gap);
    consider(body.x - labelWidth / 2, body.y - gap - labelHeight);
    consider(body.x + gap, body.y - labelHeight / 2);
    consider(body.x - gap - labelWidth, body.y - labelHeight / 2);
    // A bounded, deterministic fallback fills free space when a cluster gets dense.
    if (!best) {
      for (let y = margin; y + labelHeight <= height - margin; y += labelHeight + 4) {
        for (let x = margin; x + labelWidth <= width - margin; x += 8) consider(x, y);
      }
    }
    // A tiny panel may not fit every label. Bodies, hover details and the keyboard list remain.
    if (best) labels.push(best);
  }
  return labels;
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
  const width = canvas.width / scale;
  const height = canvas.height / scale;
  context.clearRect(0, 0, width, height);
  const largestMove = Math.max(0.05, ...sky.stars.map((star) => Math.abs(star.change ?? 0)));
  const largestValue = Math.max(0, ...sky.stars.map((star) => star.value ?? 0));

  // Spatial guides have no price scale: only relative proximity encodes correlation.
  const radius = Math.min(width, height) * 0.42;
  context.strokeStyle = palette.line;
  context.lineWidth = 1;
  context.globalAlpha = 0.45;
  for (const fraction of [0.35, 0.7, 1]) {
    context.beginPath();
    context.arc(width / 2, height / 2, radius * fraction, 0, Math.PI * 2);
    context.stroke();
  }
  context.setLineDash([2, 6]);
  context.beginPath();
  context.moveTo(width / 2, 12);
  context.lineTo(width / 2, height - 12);
  context.moveTo(12, height / 2);
  context.lineTo(width - 12, height / 2);
  context.stroke();

  // Links between strongly co-moving pairs; dashed when they move against each other.
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const c = sky.correlations[i]?.[j];
      const a = bodies[i];
      const b = bodies[j];
      if (c === undefined || Math.abs(c) < EDGE_MIN || !a || !b) continue;
      context.globalAlpha = 0.12 + (Math.abs(c) - EDGE_MIN) * 0.5;
      context.strokeStyle = palette.muted;
      context.lineWidth = 1;
      context.setLineDash(c < 0 ? [3, 3] : []);
      context.beginPath();
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance <= a.r + b.r) continue;
      const dx = (b.x - a.x) / distance;
      const dy = (b.y - a.y) / distance;
      context.moveTo(a.x + dx * (a.r + 2), a.y + dy * (a.r + 2));
      context.lineTo(b.x - dx * (b.r + 2), b.y - dy * (b.r + 2));
      context.stroke();
    }
  }
  context.setLineDash([]);

  bodies.forEach((body, index) => {
    const star = sky.stars[index];
    const change = star?.change;
    const color =
      change === undefined || change === 0 ? palette.muted : change > 0 ? palette.up : palette.down;
    const value = star?.value;
    const activity =
      value === undefined || largestValue === 0 ? 0 : Math.sqrt(value / largestValue);
    if (activity > 0) {
      const glowRadius = body.r * (1.6 + activity);
      const glow = context.createRadialGradient(
        body.x,
        body.y,
        body.r * 0.5,
        body.x,
        body.y,
        glowRadius,
      );
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'transparent');
      context.globalAlpha = 0.08 + activity * 0.14;
      context.fillStyle = glow;
      context.beginPath();
      context.arc(body.x, body.y, glowRadius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha =
      change === undefined ? 0.35 : 0.35 + 0.65 * Math.min(1, Math.abs(change) / largestMove);
    context.fillStyle = color;
    context.beginPath();
    context.arc(body.x, body.y, body.r, 0, 2 * Math.PI);
    context.fill();
    context.globalAlpha = 0.8;
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;
    if (body.id === selected) {
      context.strokeStyle = palette.live;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(body.x, body.y, body.r + 4, 0, 2 * Math.PI);
      context.stroke();
    }
    // F8: a quiet dotted ring, in the text colour (size, not direction), around a body with
    // whale prints or large liquidations in the window. Static; it never pulses.
    if ((star?.whales ?? 0) > 0) {
      context.strokeStyle = palette.text;
      context.globalAlpha = 0.7;
      context.lineWidth = 1;
      context.setLineDash([2, 3]);
      context.beginPath();
      context.arc(body.x, body.y, body.r + 8, 0, 2 * Math.PI);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
    }
  });

  context.font = `10px ${palette.font}`;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  const labels = placeLabels(context, bodies, items, selected, width, height);
  for (const label of labels) {
    const body = bodies[label.index];
    if (!body) continue;
    const x = Math.max(label.x, Math.min(body.x, label.x + label.width));
    const y = Math.max(label.y, Math.min(body.y, label.y + label.height));
    const distance = Math.hypot(x - body.x, y - body.y);
    context.globalAlpha = 0.45;
    context.strokeStyle = palette.muted;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(
      body.x + ((x - body.x) / distance) * (body.r + 5),
      body.y + ((y - body.y) / distance) * (body.r + 5),
    );
    context.lineTo(x, y);
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = palette.panel;
    context.fillRect(label.x, label.y, label.width, label.height);
    context.fillStyle = palette.text;
    context.fillText(label.text, label.x + 6, label.y + label.height / 2);
  }
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
  const perps = useMemo(() => items.flatMap((item) => perpFor(item) ?? []), [items]);
  useLiquidationFeeds(perps);
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

  // Resize and theme changes repaint even after the force layout has stopped.
  useEffect(() => {
    const target = canvas.current;
    const element = frame.current;
    if (!target || !element) return;
    const { width, height } = element.getBoundingClientRect();
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
    let palette = readPalette();
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let handle = 0;
    let started = 0;
    const paint = () => {
      draw(target, bodies.current, sky, items, selected, palette);
    };
    const tick = (now: number) => {
      const { width: w, height: h } = size.current;
      if (w === 0 || h === 0) return;
      if (motion.matches || now - started >= LAYOUT_MOTION_MS) {
        for (let step = 0; step < SETTLE_STEPS; step += 1)
          stepBodies(bodies.current, correlationOf, w, h);
        paint();
        return;
      }
      const energy = stepBodies(bodies.current, correlationOf, w, h);
      paint();
      if (energy > SETTLED) handle = window.requestAnimationFrame(tick);
    };
    const restart = () => {
      window.cancelAnimationFrame(handle);
      started = performance.now();
      if (motion.matches) tick(started);
      else handle = window.requestAnimationFrame(tick);
    };
    const resize = (w: number, h: number) => {
      size.current = { width: w, height: h };
      const scale = window.devicePixelRatio || 1;
      target.width = Math.round(w * scale);
      target.height = Math.round(h * scale);
      target.style.width = `${String(w)}px`;
      target.style.height = `${String(h)}px`;
      restart();
    };
    resize(width, height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    const themeObserver = new MutationObserver(() => {
      palette = readPalette();
      paint();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-palette', 'data-density'],
    });
    motion.addEventListener('change', restart);
    return () => {
      window.cancelAnimationFrame(handle);
      observer.disconnect();
      themeObserver.disconnect();
      motion.removeEventListener('change', restart);
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
  const shared = useSharedAvailability(items);
  const notice = shared ? availabilityNotice(shared, 'these instruments') : null;

  return (
    <div className="constellation-panel">
      <div className="constellation-readout">
        <strong>Correlation field</strong>
        <span>
          {String(items.length)} instruments · {String(sky.samples)}/
          {String(CONSTELLATION_SAMPLES - 1)} returns
        </span>
      </div>
      <div ref={frame} className="constellation-sky">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Constellation of ${String(items.length)} instruments. Relative proximity indicates correlation over 15 minutes, not price coordinates. Solid links move together; dashed links move oppositely. Size and glow show traded value; mint rings mark selection. Instrument buttons follow the map.`}
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
            {whalesText(hoveredStar?.whales ?? 0)}
            <span>{hovered.name}</span>
          </p>
        )}
        {notice ? (
          <div className="constellation-gathering constellation-notice">
            <PanelNotice notice={notice} compact />
          </div>
        ) : (
          gathering && (
            <p className="constellation-gathering">
              Gathering prices: correlations appear after {String(MIN_PAIRS)} five-second samples (
              {String(sky.samples)} so far).
            </p>
          )
        )}
      </div>
      <ul className="sr-only" aria-label="Constellation instruments">
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={item.id === selected}
              onFocus={() => {
                setHover(index);
              }}
              onBlur={() => {
                setHover(undefined);
              }}
              onClick={() => {
                selectLinked(link, item.id);
              }}
            >
              {item.label}: {formatChange(sky.stars[index]?.change)} over 15 minutes
              {whalesText(sky.stars[index]?.whales ?? 0)}
            </button>
          </li>
        ))}
      </ul>
      <p className="panel-footnote">
        15m · {String(CONSTELLATION_SAMPLES)} prices at 5s · size / glow: traded value (FX fixed)
        {' · '}colour: move · links: |r| ≥ {String(EDGE_MIN)} · dashed: inverse
        {' · '}relative positions, not price axes · dotted ring: whale prints or liquidations over{' '}
        {formatCompact(WHALE_FLOOR)} in 15m
        {link === undefined ? ' · link this panel to send clicks to other panels' : ''}
      </p>
    </div>
  );
}
