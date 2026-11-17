import type { IDockviewPanelProps } from 'dockview-react';
import { memo, useEffect, useState } from 'react';
import { playCue } from '../../app/sound';
import { Cell } from '../../design/Cell';
import { formatCompact, formatNumber } from '../../design/format';
import '../../design/market.css';
import type { TradeEvent } from '../../feeds/types';
import { useTrades } from '../../store/hooks';
import { useReportSources } from '../../store/panels';
import { instrument, type Instrument } from '../../store/symbols';
import { useTickStore } from '../../store/ticks';
import { notional, perpFor, useRadar, WHALE_FLOOR, type Radar } from '../../store/whales';
import { SymbolNotice } from '../SymbolNotice';
import { DEFAULT_SYMBOL } from './meta';

interface TapeParams {
  symbol?: string;
}

const ROWS = 80;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Trades have no id; give each event object a stable key so rows are not remounted per frame. */
const keys = new WeakMap<TradeEvent, number>();
let nextKey = 0;
function keyFor(trade: TradeEvent): number {
  let key = keys.get(trade);
  if (key === undefined) {
    nextKey += 1;
    key = nextKey;
    keys.set(trade, key);
  }
  return key;
}

type Direction = 'up' | 'down' | 'neutral';

const Row = memo(function Row({
  trade,
  direction,
  width,
  item,
  whale,
}: {
  trade: TradeEvent;
  direction: Direction;
  /** Bar width in whole percent, so rows only re-render when it visibly changes. */
  width: number;
  item: Instrument;
  /** F8: the print cleared the whale threshold. A static mark, never a flash. */
  whale: boolean;
}) {
  const value = `${formatNumber(trade.price * trade.size, 2)} ${item.quote}`;
  return (
    <li
      className="market-row tape-columns"
      data-whale={whale || undefined}
      title={whale ? `Whale print: ${value}` : value}
    >
      <span
        aria-hidden
        className={`tape-value-bar tape-value-bar--${direction}`}
        style={{ width: `${String(width)}%` }}
      />
      <time className="tape-time">{timeFormat.format(trade.ts)}</time>
      <Cell className="relative" value={trade.price} decimals={item.decimals} tone={direction} />
      <Cell
        className="relative text-muted"
        value={trade.size}
        decimals={item.kind === 'equity' ? 0 : trade.size < 0.01 ? 8 : 4}
      />
    </li>
  );
});

/** F8: what the radar saw in the last 15 minutes, in one quiet line. */
function RadarLine({ radar, item }: { radar: Radar; item: Instrument }) {
  const largest = Math.max(0, ...radar.trades.map(notional));
  const liquidated = radar.liquidations.reduce((sum, event) => sum + notional(event), 0);
  const perp = perpFor(item);
  const parts = [
    radar.trades.length === 0
      ? 'no whale prints'
      : `${String(radar.trades.length)} whale ${radar.trades.length === 1 ? 'print' : 'prints'}, largest ${formatCompact(largest)} ${item.quote}`,
  ];
  if (perp)
    parts.push(
      radar.liquidations.length === 0
        ? `no liquidations over ${formatCompact(WHALE_FLOOR)} on ${perp.label}`
        : `${String(radar.liquidations.length)} ${perp.label} ${radar.liquidations.length === 1 ? 'liquidation' : 'liquidations'}, ${formatCompact(liquidated)} USDT`,
    );
  return (
    <p
      className="tape-radar"
      data-term="Whale"
      data-active={radar.trades.length + radar.liquidations.length > 0 || undefined}
      title={`A whale print is worth at least ${formatCompact(radar.threshold)} ${item.quote}: the larger of ${formatCompact(WHALE_FLOOR)} and this symbol's top 0.5% of trades over the last hour.`}
    >
      <span className="tape-radar-label">Whales · 15 min</span> {parts.join(' · ')}
    </p>
  );
}

/** Scrolling prints, newest first. Each row's bar is sized by the trade's value. */
export default function Tape({ api, params }: IDockviewPanelProps<TapeParams>) {
  const item = instrument(params.symbol ?? DEFAULT_SYMBOL) ?? instrument(DEFAULT_SYMBOL);
  if (!item) throw new Error('default tape symbol missing from the catalog');
  const trades = useTrades(item, ROWS);
  useReportSources(api.id, trades[0] ? [trades[0].source] : []);
  const radar = useRadar(item);

  // F12: a whale print that arrives while this tape is open and live sounds once (sound is off
  // unless switched on in Settings). Prints already there when it opened, or replayed under
  // Rewind, stay silent.
  const [openedAt] = useState(Date.now);
  const live = useTickStore((state) => state.cursor === null);
  const newest = radar.trades[0];
  useEffect(() => {
    if (!newest || !live || newest.receivedAt < openedAt) return;
    playCue(
      'whale',
      `${item.id}:${String(newest.ts)}:${String(newest.price)}:${String(newest.size)}`,
    );
  }, [newest, live, openedAt, item.id]);

  // Square-root scale so one block trade does not flatten every other bar.
  const largest = Math.sqrt(Math.max(1, ...trades.map((trade) => trade.price * trade.size)));

  return (
    <div className="market-panel tape-panel">
      <div className="market-toolbar">
        <span className="market-symbol">{item.label}</span>
        <span className="market-caption">Time &amp; sales</span>
      </div>
      {item.kind !== 'fx' && <RadarLine radar={radar} item={item} />}
      <div className="market-columns tape-columns">
        <span>Time</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
      </div>
      {trades.length === 0 ? (
        <SymbolNotice item={item} waiting="Waiting for trades…" />
      ) : (
        <ol className="tape-prints">
          {trades.map((trade, index) => {
            const older = trades[index + 1];
            const direction: Direction =
              older === undefined || trade.price === older.price
                ? 'neutral'
                : trade.price > older.price
                  ? 'up'
                  : 'down';
            return (
              <Row
                key={keyFor(trade)}
                trade={trade}
                direction={direction}
                width={Math.round((Math.sqrt(trade.price * trade.size) / largest) * 100)}
                item={item}
                whale={trade.price * trade.size >= radar.threshold}
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}
