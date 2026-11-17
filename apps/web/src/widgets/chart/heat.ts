import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  UTCTimestamp,
} from 'lightweight-charts';
import { heatAlpha, heatGrid, type HeatGrid } from '../../store/heatmap';
import type { DepthSample } from '../../store/ticks';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** Cell edge in CSS pixels: fine enough to read levels, coarse enough to stay cheap. */
const CELL_PX = 3;

/**
 * F2: the order book over time, painted behind the candles. Built from the book history the
 * store already keeps (one sample a second); redrawn into an offscreen canvas only when the
 * samples or the view change, then copied, so crosshair moves cost nothing.
 */
export class LiquidityHeat implements ISeriesPrimitive {
  private chart: IChartApiBase | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private views: readonly DepthSample[] = [];
  private intervalMs = 60_000;
  private color = '#e8e8e8';
  private cache: { key: string; canvas: HTMLCanvasElement } | null = null;
  /** Reused across redraws so panning allocates nothing per frame. */
  private grid: Float32Array | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private image: ImageData | undefined;

  private readonly renderer: IPrimitivePaneRenderer = {
    draw: () => undefined,
    drawBackground: (target: Target) => {
      this.paint(target);
    },
  };

  private readonly view: IPrimitivePaneView = {
    zOrder: () => 'bottom',
    renderer: () => (this.views.length > 0 ? this.renderer : null),
  };

  attached(param: SeriesAttachedParameter): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.cache = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  /** New samples, a new bar interval or a new colour: repaint on the next frame. */
  update(views: readonly DepthSample[], intervalMs: number, color: string): void {
    this.views = views;
    this.intervalMs = intervalMs;
    this.color = color;
    this.cache = null;
    this.requestUpdate?.();
  }

  /** A moment's x: its bar's centre, shifted by how far into the bar it falls. */
  private xOf(time: number): number | null {
    if (!this.chart) return null;
    const scale = this.chart.timeScale();
    const start = Math.floor(time / this.intervalMs) * this.intervalMs;
    const centre = scale.timeToCoordinate((start / 1000) as UTCTimestamp);
    if (centre === null) return null;
    const spacing = scale.options().barSpacing;
    return centre - spacing / 2 + ((time - start) / this.intervalMs) * spacing;
  }

  private yOf(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  private paint(target: Target): void {
    const first = this.views[0];
    const last = this.views.at(-1);
    if (!first || !last) return;
    target.useBitmapCoordinateSpace(
      ({ context, mediaSize, horizontalPixelRatio, verticalPixelRatio }) => {
        const probe = last.levels[0]?.[0] ?? 0;
        // The field depends only on the samples and where time and price land on screen.
        const key = [
          this.views.length,
          last.receivedAt,
          this.xOf(first.receivedAt),
          this.xOf(last.receivedAt),
          this.yOf(probe),
          this.yOf(probe * 1.01),
          mediaSize.width,
          mediaSize.height,
          horizontalPixelRatio,
        ].join('|');
        if (this.cache?.key !== key) {
          const grid = heatGrid(
            this.views,
            {
              xOf: (time) => this.xOf(time),
              yOf: (price) => this.yOf(price),
              width: mediaSize.width,
              height: mediaSize.height,
              cell: CELL_PX,
            },
            this.grid,
          );
          this.grid = grid.values;
          this.cache = { key, canvas: this.render(grid) };
        }
        // One pixel per cell, scaled up without smoothing: cheap enough to redo while panning.
        context.imageSmoothingEnabled = false;
        context.drawImage(
          this.cache.canvas,
          0,
          0,
          this.cache.canvas.width * CELL_PX * horizontalPixelRatio,
          this.cache.canvas.height * CELL_PX * verticalPixelRatio,
        );
      },
    );
  }

  /** The grid as an image with one pixel per cell, in the token colour at each cell's opacity. */
  private render(grid: HeatGrid): HTMLCanvasElement {
    const width = Math.max(1, grid.cols);
    const height = Math.max(1, grid.rows);
    this.canvas ??= document.createElement('canvas');
    const canvas = this.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      this.image = undefined;
    }
    const context = canvas.getContext('2d');
    if (!context) return canvas;
    this.image ??= context.createImageData(width, height);
    const image = this.image;
    image.data.fill(0);
    if (grid.max > 0) {
      const [red, green, blue] = rgbOf(this.color);
      for (let cell = 0; cell < grid.cols * grid.rows; cell += 1) {
        const value = grid.values[cell] ?? 0;
        if (value <= 0) continue;
        const at = cell * 4;
        image.data[at] = red;
        image.data[at + 1] = green;
        image.data[at + 2] = blue;
        image.data[at + 3] = Math.round(heatAlpha(value, grid.max) * 255);
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }
}

/** '#rrggbb' (how the tokens are written) → its channels; a light grey otherwise. */
function rgbOf(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!match) return [232, 232, 232];
  const [, r = 'e8', g = 'e8', b = 'e8'] = match;
  return [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16)];
}
