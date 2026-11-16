import type { IDockviewPanelProps } from 'dockview-react';
import { Cell } from '../../design/Cell';
import { formatCompact } from '../../design/format';
import '../../design/market.css';
import '../../design/panels.css';
import { useCursor } from '../../store/hooks';
import { useMovers, type Mover } from '../../store/movers';
import { useReportSources } from '../../store/panels';
import { useNow } from '../useNow';

/** Movers are recomputed this often; prices in other panels still tick every frame. */
const RECOMPUTE_MS = 2000;

const toneOf = (change: number | undefined) =>
  change === undefined || change === 0 ? 'neutral' : change > 0 ? 'up' : 'down';

function MoverList({
  title,
  movers,
  empty,
  traded = false,
}: {
  title: string;
  movers: Mover[];
  empty: string;
  /** Show dollars traded instead of the price. */
  traded?: boolean;
}) {
  return (
    <section aria-label={title}>
      <h3 className="markets-group">{title}</h3>
      {movers.length === 0 ? (
        <p className="panel-empty">{empty}</p>
      ) : (
        <ul>
          {movers.map((mover) => (
            <li
              key={mover.item.id}
              className="market-row movers-columns"
              title={`${mover.item.name}${mover.item.note ? ` · ${mover.item.note}` : ''} · ${mover.source}`}
            >
              <span className="market-symbol">{mover.item.label}</span>
              {traded ? (
                <span className="text-right font-mono">${formatCompact(mover.tradedUsd)}</span>
              ) : (
                <Cell value={mover.price} decimals={mover.item.decimals} />
              )}
              <Cell
                value={mover.changePct}
                decimals={2}
                signed
                suffix="%"
                tone={toneOf(mover.changePct)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Top gainers, losers and most active across everything the terminal is showing, with breadth. */
export default function Movers({ api }: IDockviewPanelProps) {
  const now = useNow(RECOMPUTE_MS);
  const [cursor] = useCursor();
  const view = useMovers(cursor ?? now);
  useReportSources(
    api.id,
    view.universe.map((mover) => mover.source),
  );
  const { up, down, flat } = view.breadth;
  const counted = up + down + flat;
  const share = (count: number) => `${String(counted === 0 ? 0 : (count / counted) * 100)}%`;

  return (
    <div className="market-panel movers-panel">
      <div
        className="movers-breadth"
        aria-label={`Breadth: ${String(up)} up, ${String(down)} down`}
      >
        <div className="movers-breadth-counts">
          <span className="text-up">{up} up</span>
          <span className="derivs-muted">
            {flat > 0 ? `${String(flat)} flat · ` : ''}
            {counted} of {view.universe.length} symbols
          </span>
          <span className="text-down">{down} down</span>
        </div>
        <div className="movers-bar" role="presentation">
          <span className="movers-bar-up" style={{ width: share(up) }} />
          <span className="movers-bar-flat" style={{ width: share(flat) }} />
          <span className="movers-bar-down" style={{ width: share(down) }} />
        </div>
      </div>
      <MoverList title="Top gainers" movers={view.gainers} empty="Nothing up yet." />
      <MoverList title="Top losers" movers={view.losers} empty="Nothing down yet." />
      <MoverList title="Most active" movers={view.active} empty="No trades seen yet." traded />
      <p className="panel-footnote">
        Across every symbol the terminal is showing right now: open more panels or boards to widen
        it. Change is against 24 hours ago for crypto and FX and the previous close for stocks. Most
        active: dollars traded in the last hour this page has seen (USDT as USD; stocks count IEX
        trades only).
      </p>
    </div>
  );
}
