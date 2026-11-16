import type { IDockviewPanelProps } from 'dockview-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Cell } from '../../design/Cell';
import { formatCompact, formatNumber } from '../../design/format';
import '../../design/market.css';
import { availabilityNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import { useSharedAvailability } from '../../store/availability';
import { useCursor, useLiquidations, useTick } from '../../store/hooks';
import { useReportSources } from '../../store/panels';
import { PERPS, type Perp } from '../../store/perps';
import { REWIND_MS } from '../../store/ticks';
import { RowReason } from '../RowReason';
import { useNow } from '../useNow';

const LIST_ROWS = 40;
/** Enough to total an hour of liquidations on these five perps. */
const TOTAL_ROWS = 5000;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** 11_520_000 → "3h 12m"; under an hour, minutes and seconds. */
function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${String(hours)}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(minutes)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

const PerpRow = memo(function PerpRow({
  perp,
  at,
  onSource,
}: {
  perp: Perp;
  /** The moment shown: now, or the Rewind cursor. */
  at: number;
  onSource: (id: string, source: string | undefined) => void;
}) {
  const tick = useTick(perp, 'deriv');
  const source = tick?.source;
  useEffect(() => {
    onSource(perp.id, source);
  }, [perp.id, source, onSource]);

  return (
    <li className="market-row derivs-columns" title={`${perp.name} · ${perp.label}`}>
      <span className="market-symbol">{perp.base}</span>
      {tick ? (
        <Cell value={tick.markPrice} decimals={perp.decimals} />
      ) : (
        <RowReason symbol={perp} label={`${perp.base} perp`} />
      )}
      <Cell value={tick ? tick.fundingRate * 100 : undefined} decimals={4} signed suffix="%" />
      <span className="derivs-muted text-right font-mono">
        {tick && tick.nextFundingTime > 0 ? countdown(tick.nextFundingTime - at) : '—'}
      </span>
      <span
        className="text-right font-mono text-num"
        title={
          tick?.openInterest == null
            ? undefined
            : `${formatNumber(tick.openInterest, 0)} ${perp.base}`
        }
      >
        {tick?.openInterestUsd == null ? '—' : `$${formatCompact(tick.openInterestUsd)}`}
      </span>
    </li>
  );
});

/**
 * USDT perpetuals: funding, mark price and open interest per coin, and the latest liquidations,
 * from Bybit with OKX and Binance futures as fallbacks.
 */
export default function Derivatives({ api }: IDockviewPanelProps) {
  const now = useNow(1000);
  const [cursor] = useCursor();
  const at = cursor ?? now;
  const [rowSources, setRowSources] = useState<Record<string, string>>({});
  const onSource = useCallback((id: string, source: string | undefined) => {
    setRowSources((current) => {
      if (current[id] === source) return current;
      const others = Object.entries(current).filter(([key]) => key !== id);
      return Object.fromEntries(source === undefined ? others : [...others, [id, source]]);
    });
  }, []);

  const shared = useSharedAvailability(PERPS);
  const notice = shared ? availabilityNotice(shared, 'the perpetual futures') : null;
  const liquidations = useLiquidations(PERPS, TOTAL_ROWS);
  const totals = useMemo(() => {
    const since = at - REWIND_MS;
    const sum = { long: 0, short: 0 };
    for (const event of liquidations) {
      if (event.ts >= since && event.ts <= at) sum[event.side] += event.size * event.price;
    }
    return sum;
  }, [liquidations, at]);
  const liquidationSources = [...new Set(liquidations.slice(0, LIST_ROWS).map((e) => e.source))];
  useReportSources(api.id, [...Object.values(rowSources), ...liquidationSources]);

  return (
    <div className="market-panel derivs-panel">
      <div className="market-columns derivs-columns">
        <span>Perp</span>
        <span className="text-right">Mark</span>
        <span
          className="text-right"
          title="Rate for the current funding interval (8 h on most). Positive: longs pay shorts."
        >
          Funding
        </span>
        <span className="text-right">Next</span>
        <span className="text-right" title="Open interest in USD; hover a value for coins">
          OI
        </span>
      </div>
      {notice && <PanelNotice notice={notice} compact />}
      <ul>
        {PERPS.map((perp) => (
          <PerpRow key={perp.id} perp={perp} at={at} onSource={onSource} />
        ))}
      </ul>

      <div className="derivs-heading">
        <h3 className="markets-group">Liquidations</h3>
        <span
          className="derivs-muted font-mono"
          title="Since this page opened, at most the last hour"
        >
          last hour: longs ${formatCompact(totals.long)} · shorts ${formatCompact(totals.short)}
        </span>
      </div>
      <div className="market-columns liquidation-columns">
        <span>Time</span>
        <span>Perp</span>
        <span>Position</span>
        <span className="text-right">Price</span>
        <span className="text-right">USD</span>
      </div>
      {liquidations.length === 0 ? (
        <p className="panel-empty">No liquidations since this page opened.</p>
      ) : (
        <ul>
          {liquidations.slice(0, LIST_ROWS).map((event, index) => {
            const perp = PERPS.find((item) => item.id === event.symbol);
            return (
              <li
                key={`${event.symbol}-${String(event.ts)}-${String(index)}`}
                className="market-row liquidation-columns"
              >
                <time className="derivs-muted font-mono">{timeFormat.format(event.ts)}</time>
                <span className="market-symbol">{perp?.base ?? event.symbol}</span>
                <span>{event.side === 'long' ? 'Long' : 'Short'}</span>
                <Cell value={event.price} decimals={perp?.decimals ?? 2} />
                <span
                  className="text-right font-mono text-num"
                  title={`${formatNumber(event.size, 4)} ${perp?.base ?? ''}`}
                >
                  ${formatCompact(event.size * event.price)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="panel-footnote">
        Public futures data from Bybit, falling back to OKX, then Binance. Exchanges can refuse some
        countries; if all three do, the badge reads offline. Funding is per interval; open interest
        is in USD. Bybit and OKX send every liquidation, Binance only the largest per coin each
        second.
      </p>
    </div>
  );
}
