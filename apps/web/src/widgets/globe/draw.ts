import { geoCircle, geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import land110m from 'world-atlas/land-110m.json';
import {
  antisolarPoint,
  EXCHANGES,
  NEW_YORK,
  subsolarPoint,
  type LonLat,
  type Move,
} from './model';

/**
 * The globe's drawing, loaded only when a globe panel opens: d3-geo's orthographic projection
 * (it clips to the visible hemisphere) and Natural Earth's 1:110m land outlines (public domain),
 * through the world-atlas package.
 */

const topology = land110m as unknown as Topology<{ land: GeometryCollection }>;
// The land object is one GeometryCollection, so `feature` returns a FeatureCollection.
const LAND = feature(topology, topology.objects.land) as unknown as FeatureCollection<
  Polygon | MultiPolygon
>;
const GRATICULE = geoGraticule10();
/** Night: more than 90° from the sun. Twilight: the 6° beyond the horizon (civil twilight). */
const NIGHT_RADIUS = 90;
const TWILIGHT_RADIUS = 96;
/** Labels within this angle of the rim are hidden: they would sit on the edge, foreshortened. */
const LABEL_HORIZON = Math.PI / 2 - 0.02;

export interface Palette {
  theme: 'dark' | 'light';
  bg: string;
  line: string;
  text: string;
  muted: string;
  live: string;
  up: string;
  down: string;
  font: string;
}

export interface Scene {
  width: number;
  height: number;
  /** Device pixels per CSS pixel. */
  ratio: number;
  centre: LonLat;
  now: number;
  /** Session ids (store/sessions.ts) open now. */
  open: ReadonlySet<string>;
  moves: readonly Move[];
}

/** The disc's radius for a panel size, leaving room for labels. */
export function radiusFor(width: number, height: number): number {
  return Math.max(40, Math.min(width, height) / 2 - 16);
}

const asPoint = (point: LonLat): [number, number] => [point[0], point[1]];

/** Paint one frame: on resize, drag, theme change, and once a minute for the sun. */
export function drawGlobe(context: CanvasRenderingContext2D, scene: Scene, palette: Palette): void {
  const { width, height, ratio, centre } = scene;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const projection = geoOrthographic()
    .rotate([-centre[0], -centre[1]])
    .translate([width / 2, height / 2])
    .scale(radiusFor(width, height))
    .precision(0.5);
  const path = geoPath(projection, context);
  const visible = (point: LonLat) => geoDistance(asPoint(point), asPoint(centre)) < LABEL_HORIZON;

  context.beginPath();
  path({ type: 'Sphere' });
  context.fillStyle = palette.bg;
  context.fill();

  context.beginPath();
  path(GRATICULE);
  context.strokeStyle = palette.line;
  context.lineWidth = 0.35;
  context.stroke();

  context.beginPath();
  path(LAND);
  context.globalAlpha = palette.theme === 'dark' ? 0.42 : 0.2;
  context.fillStyle = palette.muted;
  context.fill();
  context.globalAlpha = 1;
  context.strokeStyle = palette.muted;
  context.lineWidth = 0.75;
  context.stroke();

  // Day and night. The sphere is the background colour, so dark mode lifts the day side (up to
  // 96° from the sun, through civil twilight) and light mode darkens the night side (beyond 90°).
  // Twilight, the 6° past the horizon, gets half the shade.
  const lit = palette.theme === 'dark';
  const centreOfShade = asPoint(lit ? subsolarPoint(scene.now) : antisolarPoint(scene.now));
  const half = (lit ? 0.2 : 0.24) / 2;
  const twilight = TWILIGHT_RADIUS - NIGHT_RADIUS;
  const layers: readonly (readonly [number, number])[] = lit
    ? [
        [NIGHT_RADIUS + twilight, half],
        [NIGHT_RADIUS, half],
      ]
    : [
        [NIGHT_RADIUS, half],
        [NIGHT_RADIUS - twilight, half],
      ];
  for (const [radius, alpha] of layers) {
    context.beginPath();
    path(geoCircle().center(centreOfShade).radius(radius)());
    context.globalAlpha = alpha;
    context.fillStyle = palette.muted;
    context.fill();
  }
  context.globalAlpha = 1;

  context.beginPath();
  path({ type: 'Sphere' });
  context.strokeStyle = palette.muted;
  context.lineWidth = 0.75;
  context.stroke();

  // Arcs: from New York, where the country ETFs trade, to the markets that moved most.
  for (const move of scene.moves) {
    context.beginPath();
    path({ type: 'LineString', coordinates: [asPoint(NEW_YORK), asPoint(move.at)] });
    context.strokeStyle = move.changePct >= 0 ? palette.up : palette.down;
    context.lineWidth = 1.25;
    context.stroke();
  }

  // Dots first, then labels: each label takes the first free spot beside its dot, or is left out
  // (the legend under the globe lists every open exchange and move anyway).
  const labels: Label[] = [];

  // Exchanges: mint when open (interface state, not a price), a muted ring when closed.
  for (const exchange of EXCHANGES) {
    if (!visible(exchange.at)) continue;
    const xy = projection(asPoint(exchange.at));
    if (!xy) continue;
    const open = scene.open.has(exchange.session);
    context.beginPath();
    context.arc(xy[0], xy[1], open ? 4 : 3, 0, Math.PI * 2);
    if (open) {
      context.fillStyle = palette.live;
      context.fill();
      context.beginPath();
      context.arc(xy[0], xy[1], 7, 0, Math.PI * 2);
      context.strokeStyle = palette.live;
      context.globalAlpha = 0.35;
      context.lineWidth = 0.75;
      context.stroke();
      context.globalAlpha = 1;
    } else {
      context.strokeStyle = palette.muted;
      context.lineWidth = 1;
      context.stroke();
    }
    labels.push({
      text: exchange.city,
      at: xy,
      colour: open ? palette.text : palette.muted,
      side: 'beside',
    });
  }

  for (const move of scene.moves) {
    if (!visible(move.at)) continue;
    const xy = projection(asPoint(move.at));
    if (!xy) continue;
    const colour = move.changePct >= 0 ? palette.up : palette.down;
    context.beginPath();
    context.arc(xy[0], xy[1], 2.5, 0, Math.PI * 2);
    context.fillStyle = colour;
    context.fill();
    const sign = move.changePct > 0 ? '+' : '';
    // Moves go first: they are the reason the arcs are there.
    labels.unshift({
      text: `${move.country} ${sign}${move.changePct.toFixed(2)}%`,
      at: xy,
      colour,
      side: 'under',
    });
  }

  context.font = `11px ${palette.font}`;
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  const placed: Box[] = [];
  // A halo in the background colour keeps labels readable where arcs and coastlines cross them.
  context.lineJoin = 'round';
  context.lineWidth = 3;
  context.strokeStyle = palette.bg;
  for (const label of labels) {
    const box = placeLabel(label, context.measureText(label.text).width, placed, width, height);
    if (!box) continue;
    placed.push(box);
    const baseline = box.y + LABEL_HEIGHT / 2;
    context.strokeText(label.text, box.x, baseline);
    context.fillStyle = label.colour;
    context.fillText(label.text, box.x, baseline);
  }
}

interface Label {
  text: string;
  at: [number, number];
  colour: string;
  /** City names sit beside their dot; move labels under or over theirs. */
  side: 'beside' | 'under';
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LABEL_HEIGHT = 12;
const LABEL_GAP = 7;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The first spot beside a dot that is on the canvas and clear of the labels already placed. */
export function placeLabel(
  label: Pick<Label, 'at' | 'side'>,
  textWidth: number,
  placed: readonly Box[],
  width: number,
  height: number,
): Box | null {
  const [x, y] = label.at;
  const half = LABEL_HEIGHT / 2;
  const spots: [number, number][] =
    label.side === 'beside'
      ? [
          [x + LABEL_GAP, y - half],
          [x - LABEL_GAP - textWidth, y - half],
          [x - textWidth / 2, y - LABEL_GAP - LABEL_HEIGHT],
          [x - textWidth / 2, y + LABEL_GAP],
        ]
      : [
          [x - textWidth / 2, y + LABEL_GAP],
          [x - textWidth / 2, y - LABEL_GAP - LABEL_HEIGHT],
          [x + LABEL_GAP, y - half],
          [x - LABEL_GAP - textWidth, y - half],
        ];
  for (const [left, top] of spots) {
    const box = { x: left, y: top, width: textWidth, height: LABEL_HEIGHT };
    const inside =
      left >= 2 && top >= 2 && left + textWidth <= width - 2 && top + LABEL_HEIGHT <= height - 2;
    if (inside && !placed.some((other) => overlaps(box, other))) return box;
  }
  return null;
}
