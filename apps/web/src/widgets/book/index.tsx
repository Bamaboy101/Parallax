import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useState } from 'react';
import { Cell } from '../../design/Cell';
import type { Level } from '../../feeds/types';
import { useBook } from '../../store/hooks';
import { useReportSources } from '../../store/panels';
import { instrument, type Instrument } from '../../store/symbols';
import { DEFAULT_SYMBOL } from './meta';

interface BookParams {
  symbol?: string;
}

const CURVE_HEIGHT = 56;

/** Running totals from the best price outwards. */
function cumulative(levels: readonly Level[]): number[] {
  let total = 0;
  return levels.map(([, size]) => (total += size));
}

/** Height of an element, kept in sync with resizes. Returns a callback ref and the height. */
function useHeight(): [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return [setElement, height];
}

/** Cumulative depth either side of the mid price, as two filled step curves. */
function DepthCurve({ bids, asks }: { bids: readonly Level[]; asks: readonly Level[] }) {
  const bestBid = bids[0]?.[0];
  const bestAsk = asks[0]?.[0];
  const lowest = bids.at(-1)?.[0];
  const highest = asks.at(-1)?.[0];
  if (
    bestBid === undefined ||
    bestAsk === undefined ||
    lowest === undefined ||
    highest === undefined
  ) {
    return <div style={{ height: CURVE_HEIGHT }} />;
  }
  const mid = (bestBid + bestAsk) / 2;
  const reach = Math.max(mid - lowest, highest - mid) || 1;
  const bidTotals = cumulative(bids);
  const askTotals = cumulative(asks);
  const deepest = Math.max(bidTotals.at(-1) ?? 0, askTotals.at(-1) ?? 0) || 1;
  const width = 200;
  const x = (price: number) => ((price - (mid - reach)) / (2 * reach)) * width;
  const y = (total: number) => CURVE_HEIGHT - (total / deepest) * (CURVE_HEIGHT - 2);

  const steps = (levels: readonly Level[], totals: number[]) => {
    const points: string[] = [`${x(levels[0]?.[0] ?? mid).toFixed(2)},${String(CURVE_HEIGHT)}`];
    levels.forEach(([price], index) => {
      const previous = index === 0 ? 0 : (totals[index - 1] ?? 0);
      points.push(`${x(price).toFixed(2)},${y(previous).toFixed(2)}`);
      points.push(`${x(price).toFixed(2)},${y(totals[index] ?? 0).toFixed(2)}`);
    });
    points.push(`${x(levels.at(-1)?.[0] ?? mid).toFixed(2)},${String(CURVE_HEIGHT)}`);
    return points.join(' ');
  };

  return (
    <svg
      aria-label="Depth curve"
      role="img"
      viewBox={`0 0 ${String(width)} ${String(CURVE_HEIGHT)}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height: CURVE_HEIGHT }}
    >
      <polygon
        points={steps(bids, bidTotals)}
        className="fill-up/15 stroke-up"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={steps(asks, askTotals)}
        className="fill-down/15 stroke-down"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Ladder({
  levels,
  totals,
  deepest,
  side,
  item,
}: {
  levels: readonly Level[];
  totals: number[];
  deepest: number;
  side: 'bid' | 'ask';
  item: Instrument;
}) {
  return levels.map(([price, size], index) => (
    <li key={price} className="relative grid h-(--row-h) grid-cols-3 items-center gap-2 px-(--pad)">
      <span
        aria-hidden
        className={`absolute inset-y-px right-0 ${side === 'bid' ? 'bg-up/10' : 'bg-down/10'}`}
        style={{ width: `${(((totals[index] ?? 0) / deepest) * 100).toFixed(1)}%` }}
      />
      <Cell
        className="relative text-left"
        value={price}
        decimals={item.decimals}
        tone={side === 'bid' ? 'up' : 'down'}
      />
      <Cell className="relative" value={size} decimals={4} />
      <Cell className="relative text-muted" value={totals[index]} decimals={4} />
    </li>
  ));
}

/** Bids and asks around the spread, with cumulative depth bars and a depth curve. */
export default function OrderBook({ api, params }: IDockviewPanelProps<BookParams>) {
  const item = instrument(params.symbol ?? DEFAULT_SYMBOL) ?? instrument(DEFAULT_SYMBOL);
  if (!item) throw new Error('default book symbol missing from the catalog');
  const book = useBook(item);
  useReportSources(api.id, book ? [book.source] : []);

  const [ladderRef, ladderHeight] = useHeight();
  const rowHeight =
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 28;
  // Rows per side: what fits around the spread row.
  const rows = Math.max(1, Math.floor((ladderHeight / rowHeight - 1) / 2));

  if (!book || book.bids.length === 0 || book.asks.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-panel text-label text-muted">
        Waiting for the {item.label} book…
      </div>
    );
  }

  const bids = book.bids.slice(0, rows);
  const asks = book.asks.slice(0, rows);
  const bidTotals = cumulative(bids);
  const askTotals = cumulative(asks);
  const deepest = Math.max(bidTotals.at(-1) ?? 0, askTotals.at(-1) ?? 0) || 1;
  const bestBid = book.bids[0]?.[0] ?? 0;
  const bestAsk = book.asks[0]?.[0] ?? 0;
  const spread = bestAsk - bestBid;
  const mid = (bestAsk + bestBid) / 2;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="grid h-(--row-h) shrink-0 grid-cols-3 items-center gap-2 border-b border-line px-(--pad) text-label text-muted">
        <span>{item.label}</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      <DepthCurve bids={book.bids} asks={book.asks} />
      <div ref={ladderRef} className="min-h-0 flex-1 overflow-hidden border-t border-line">
        <ol aria-label="Asks" className="flex flex-col-reverse">
          <Ladder levels={asks} totals={askTotals} deepest={deepest} side="ask" item={item} />
        </ol>
        <div
          className="flex h-(--row-h) items-center justify-between border-y border-line px-(--pad) text-label text-muted"
          title="Best ask minus best bid"
        >
          <span>Spread</span>
          <span className="font-mono text-num text-text">
            <Cell value={spread} decimals={item.decimals} />
            <span className="ml-2 text-muted">{((spread / mid) * 10_000).toFixed(1)} bp</span>
          </span>
        </div>
        <ol aria-label="Bids">
          <Ladder levels={bids} totals={bidTotals} deepest={deepest} side="bid" item={item} />
        </ol>
      </div>
    </div>
  );
}
