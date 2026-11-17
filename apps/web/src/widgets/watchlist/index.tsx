import { SymbolLabel } from '../../design/SymbolLabel';
import type { IDockviewPanelProps } from 'dockview-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cell } from '../../design/Cell';
import { Sparkline } from '../../design/Sparkline';
import '../../design/market.css';
import { availabilityNotice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import { useSharedAvailability } from '../../store/availability';
import { usePriceLine } from '../../store/hooks';
import { linkGroupOf, selectLinked, useLinkStore, type LinkGroup } from '../../store/links';
import { useReportSources } from '../../store/panels';
import { instruments, type Instrument } from '../../store/symbols';
import { RowReason } from '../RowReason';
import { DEFAULT_SYMBOLS } from './meta';

interface WatchlistParams {
  symbols?: string[];
  link?: number;
}

const toneOf = (change: number | undefined) =>
  change === undefined || change === 0 ? 'neutral' : change > 0 ? 'up' : 'down';

function Row({
  item,
  link,
  onSource,
}: {
  item: Instrument;
  /** The panel's link group; rows then select the symbol for every panel in the group. */
  link: LinkGroup | undefined;
  onSource: (id: string, source: string) => void;
}) {
  const line = usePriceLine(item);
  const tone = toneOf(line.changePct);
  const { source } = line;
  const selected = useLinkStore((state) => link !== undefined && state.symbols[link] === item.id);
  useEffect(() => {
    if (source) onSource(item.id, source);
  }, [item.id, source, onSource]);

  return (
    <li
      className={
        link === undefined
          ? 'market-row watchlist-columns'
          : 'market-row watchlist-columns is-linkable'
      }
      title={item.note ? `${item.name} · ${item.note}` : item.name}
      aria-current={selected ? 'true' : undefined}
      onClick={
        link === undefined
          ? undefined
          : () => {
              selectLinked(link, item.id);
            }
      }
    >
      {link === undefined ? (
        <span className="market-symbol">
          <SymbolLabel item={item} />
        </span>
      ) : (
        <button type="button" className="market-symbol watchlist-select">
          <SymbolLabel item={item} />
        </button>
      )}
      <span className="watchlist-sparkline">
        <Sparkline
          values={
            line.live && line.price !== undefined ? [...line.closes, line.price] : line.closes
          }
          tone={tone}
          width={40}
        />
      </span>
      {line.price === undefined ? (
        <RowReason symbol={item} label={item.label} />
      ) : (
        <span
          className={line.live ? 'text-right' : 'text-right opacity-60'}
          title={line.live ? undefined : 'Last hourly close; no live trade yet'}
        >
          <Cell value={line.price} decimals={item.decimals} pulse={line.live} />
        </span>
      )}
      <Cell value={line.changePct} decimals={2} signed suffix="%" tone={tone} />
    </li>
  );
}

/** Price, rolling 24-hour change and a 24-hour sparkline for any mix of symbols. */
export default function Watchlist({ api, params }: IDockviewPanelProps<WatchlistParams>) {
  const items = useMemo(() => instruments(params.symbols ?? DEFAULT_SYMBOLS), [params.symbols]);
  const shared = useSharedAvailability(items);
  const notice = shared && items.length > 1 ? availabilityNotice(shared, 'these symbols') : null;
  const link = linkGroupOf(params);
  const [sources, setSources] = useState<Record<string, string>>({});
  const onSource = useCallback((id: string, source: string) => {
    setSources((current) => (current[id] === source ? current : { ...current, [id]: source }));
  }, []);
  useReportSources(api.id, Object.values(sources));

  return (
    <div className="market-panel watchlist-panel">
      <div className="market-columns watchlist-columns">
        <span>Symbol</span>
        <span
          className="watchlist-sparkline"
          title="Last 24 hours; the latest session for US stocks"
        >
          Trend
        </span>
        <span className="text-right">Last</span>
        <span
          className="text-right"
          title="24-hour change; for US stocks, change since the previous session's close"
        >
          Chg
        </span>
      </div>
      {notice && <PanelNotice notice={notice} compact />}
      {items.length === 0 ? (
        <p className="panel-empty">
          This watchlist is empty. Type a symbol in the command bar, e.g. “watch sol”, to add one.
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <Row key={item.id} item={item} link={link} onSource={onSource} />
          ))}
        </ul>
      )}
    </div>
  );
}
