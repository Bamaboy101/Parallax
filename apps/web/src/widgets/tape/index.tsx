import type { IDockviewPanelProps } from 'dockview-react';
import { memo } from 'react';
import { Cell } from '../../design/Cell';
import { formatNumber } from '../../design/format';
import '../../design/market.css';
import type { TradeEvent } from '../../feeds/types';
import { useTrades } from '../../store/hooks';
import { useReportSources } from '../../store/panels';
import { instrument, type Instrument } from '../../store/symbols';
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
}: {
  trade: TradeEvent;
  direction: Direction;
  /** Bar width in whole percent, so rows only re-render when it visibly changes. */
  width: number;
  item: Instrument;
}) {
  return (
    <li
      className="market-row tape-columns"
      title={`${formatNumber(trade.price * trade.size, 2)} ${item.quote}`}
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

/** Scrolling prints, newest first. Each row's bar is sized by the trade's value. */
export default function Tape({ api, params }: IDockviewPanelProps<TapeParams>) {
  const item = instrument(params.symbol ?? DEFAULT_SYMBOL) ?? instrument(DEFAULT_SYMBOL);
  if (!item) throw new Error('default tape symbol missing from the catalog');
  const trades = useTrades(item, ROWS);
  useReportSources(api.id, trades[0] ? [trades[0].source] : []);

  // Square-root scale so one block trade does not flatten every other bar.
  const largest = Math.sqrt(Math.max(1, ...trades.map((trade) => trade.price * trade.size)));

  return (
    <div className="market-panel tape-panel">
      <div className="market-toolbar">
        <span className="market-symbol">{item.label}</span>
        <span className="market-caption">Time &amp; sales</span>
      </div>
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
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}
