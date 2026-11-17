import type { IDockviewPanelProps } from 'dockview-react';
import { useState } from 'react';
import { Cell } from '../../design/Cell';
import { formatCompact } from '../../design/format';
import '../../design/market.css';
import { failureNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import '../../design/paper.css';
import { requestSettings } from '../../design/settingsRequest';
import { useReportSources } from '../../store/panels';
import type { PaperOrder, PaperPosition } from '../../store/paper/parse';
import {
  cancelPaperOrder,
  PAPER_SOURCE,
  placePaperOrder,
  usePaperFeed,
  usePaperStore,
} from '../../store/paper/store';

const SOURCES = [PAPER_SOURCE];
const toneOf = (value: number | null | undefined) =>
  value == null || value === 0 ? 'neutral' : value > 0 ? 'up' : 'down';
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function PositionRow({
  position,
  onMessage,
}: {
  position: PaperPosition;
  onMessage: (text: string) => void;
}) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    // Closing is a market order the other way for the whole position.
    void placePaperOrder({
      symbol: position.symbol,
      side: position.side === 'long' ? 'sell' : 'buy',
      type: 'market',
      qty: Math.abs(position.qty),
    }).then((result) => {
      setClosing(false);
      onMessage(
        result.ok
          ? `Paper order to close ${position.symbol}: ${result.order.status}.`
          : result.message,
      );
    });
  };
  return (
    <li className="market-row paper-positions">
      <span className="market-symbol">{position.symbol}</span>
      <Cell value={position.qty} decimals={0} signed={position.side === 'short'} />
      <Cell value={position.avgEntry} decimals={2} />
      <Cell value={position.price} decimals={2} />
      <span className="text-right font-mono text-num">${formatCompact(position.marketValue)}</span>
      <span className="paper-pl">
        <Cell
          value={position.unrealizedPl}
          decimals={2}
          signed
          tone={toneOf(position.unrealizedPl)}
        />
        <Cell
          value={position.unrealizedPlPct === null ? null : position.unrealizedPlPct * 100}
          decimals={2}
          signed
          suffix="%"
          tone={toneOf(position.unrealizedPlPct)}
        />
      </span>
      <button type="button" className="chart-interval" disabled={closing} onClick={close}>
        Close
      </button>
    </li>
  );
}

function OrderRow({ order, onMessage }: { order: PaperOrder; onMessage: (text: string) => void }) {
  const [cancelling, setCancelling] = useState(false);
  return (
    <li className="market-row paper-orders">
      <span className="market-symbol">{order.symbol}</span>
      <span className={order.side === 'buy' ? 'paper-side' : 'paper-side is-sell'}>
        {order.side}
      </span>
      <Cell value={order.qty} decimals={0} />
      <span className="paper-type">
        {order.type === 'limit' ? `limit ${String(order.limitPrice ?? '')}` : order.type}
      </span>
      <span
        className="paper-status"
        title={order.submittedAt ? `Sent ${timeFormat.format(order.submittedAt)}` : undefined}
      >
        {order.status.replaceAll('_', ' ')}
      </span>
      <button
        type="button"
        className="chart-interval"
        disabled={cancelling}
        onClick={() => {
          setCancelling(true);
          void cancelPaperOrder(order.id).then((result) => {
            setCancelling(false);
            onMessage(
              result.ok
                ? `Cancelled the paper ${order.side} of ${order.symbol}.`
                : (result.message ?? ''),
            );
          });
        }}
      >
        Cancel
      </button>
    </li>
  );
}

/**
 * The user's Alpaca paper account (F4): equity, today's profit and loss, positions and open
 * orders, with cancel and close. Fake money only; Parallax has no live trading path.
 */
export default function Paper({ api }: IDockviewPanelProps) {
  usePaperFeed();
  useReportSources(api.id, SOURCES);
  const paper = usePaperStore();
  const [message, setMessage] = useState<string | null>(null);
  const account = paper.account;
  const dayPl = account ? account.equity - account.lastEquity : null;

  return (
    <div className="market-panel paper-panel">
      <div className="panel-toolbar">
        <span className="paper-mode">PAPER</span>
        <span className="panel-heading">Paper account</span>
        <span className="panel-caption">
          Fake money · Alpaca paper · live trading is not possible here
        </span>
      </div>
      {paper.state === 'no-key' && (
        <PanelNotice
          notice={{
            tone: 'info',
            title: 'Add your free Alpaca paper key to trade with fake money',
            detail:
              'The same key streams US stocks. It stays in this browser and goes only to Alpaca’s paper environment.',
            action: 'settings',
          }}
        />
      )}
      {paper.state === 'live-key' && (
        <PanelNotice
          notice={{
            tone: 'warn',
            title: 'The saved Alpaca key is a live-trading key',
            detail: 'It is never sent. Paper trading needs your paper key, which starts with PK.',
            action: 'settings',
          }}
        />
      )}
      {paper.failure && (
        <PanelNotice
          notice={failureNotice(paper.failure, 'Alpaca paper')}
          compact={account !== null}
        />
      )}
      {paper.state === 'loading' && <p className="panel-empty">Loading the paper account…</p>}
      {account && (
        <dl className="paper-account">
          <div>
            <dt>Equity</dt>
            <dd>
              <Cell value={account.equity} decimals={2} />
            </dd>
          </div>
          <div>
            <dt title="Equity now against the previous close">Today</dt>
            <dd>
              <Cell value={dayPl} decimals={2} signed tone={toneOf(dayPl)} />
            </dd>
          </div>
          <div>
            <dt>Buying power</dt>
            <dd>
              <Cell value={account.buyingPower} decimals={2} />
            </dd>
          </div>
          <div>
            <dt>Cash</dt>
            <dd>
              <Cell value={account.cash} decimals={2} />
            </dd>
          </div>
        </dl>
      )}
      {message && (
        <p className="paper-ticket-note" role="status">
          {message}
        </p>
      )}
      {account && (
        <>
          <section aria-label="Positions">
            <h3 className="markets-group">
              Positions <span className="paper-mode">PAPER</span>
            </h3>
            {paper.positions.length === 0 ? (
              <p className="panel-empty">
                No positions. Open a stock or ETF chart and press “Paper trade” to place an order.
              </p>
            ) : (
              <ul>
                <li className="market-columns paper-positions" aria-hidden="true">
                  <span>Symbol</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Avg</span>
                  <span className="text-right">Last</span>
                  <span className="text-right">Value</span>
                  <span className="text-right">P&amp;L</span>
                  <span />
                </li>
                {paper.positions.map((position) => (
                  <PositionRow key={position.symbol} position={position} onMessage={setMessage} />
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Open orders">
            <h3 className="markets-group">
              Open orders <span className="paper-mode">PAPER</span>
            </h3>
            {paper.orders.length === 0 ? (
              <p className="panel-empty">No open orders.</p>
            ) : (
              <ul>
                <li className="market-columns paper-orders" aria-hidden="true">
                  <span>Symbol</span>
                  <span>Side</span>
                  <span className="text-right">Qty</span>
                  <span>Type / limit</span>
                  <span>Status</span>
                  <span />
                </li>
                {paper.orders.map((order) => (
                  <OrderRow key={order.id} order={order} onMessage={setMessage} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <p className="panel-footnote">
        Alpaca’s paper environment simulates fills against live quotes; it ignores slippage, market
        impact and dividends. Orders are day orders in whole shares.{' '}
        {paper.state === 'no-key' && (
          <button type="button" className="panel-notice-action" onClick={requestSettings}>
            Open Settings
          </button>
        )}
      </p>
    </div>
  );
}
