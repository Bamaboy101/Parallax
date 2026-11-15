import type { IDockviewPanelProps } from 'dockview-react';
import { useCallback, useEffect, useState } from 'react';
import { Cell } from '../../design/Cell';
import { Sparkline } from '../../design/Sparkline';
import { usePriceLine } from '../../store/hooks';
import { useReportSources } from '../../store/panels';
import { instruments, type Instrument } from '../../store/symbols';
import { DEFAULT_SYMBOLS } from './meta';

interface WatchlistParams {
  symbols?: string[];
}

const COLUMNS = 'grid-cols-[minmax(64px,1fr)_40px_80px_56px]';

const toneOf = (change: number | undefined) =>
  change === undefined || change === 0 ? 'neutral' : change > 0 ? 'up' : 'down';

function Row({
  item,
  onSource,
}: {
  item: Instrument;
  onSource: (id: string, source: string) => void;
}) {
  const line = usePriceLine(item);
  const tone = toneOf(line.changePct);
  const { source } = line;
  useEffect(() => {
    if (source) onSource(item.id, source);
  }, [item.id, source, onSource]);

  return (
    <li
      className={`grid h-(--row-h) ${COLUMNS} items-center gap-2 border-b border-line/60 px-(--pad) last:border-b-0`}
      title={item.note ? `${item.name} · ${item.note}` : item.name}
    >
      <span className="min-w-0 truncate font-medium text-text">{item.label}</span>
      <Sparkline
        values={line.live && line.price !== undefined ? [...line.closes, line.price] : line.closes}
        tone={tone}
        width={40}
      />
      <span
        className={line.live ? 'text-right' : 'text-right opacity-60'}
        title={line.live ? undefined : 'Last hourly close; no live trade yet'}
      >
        <Cell value={line.price} decimals={item.decimals} pulse={line.live} />
      </span>
      <Cell value={line.changePct} decimals={2} signed suffix="%" tone={tone} />
    </li>
  );
}

/** Price, rolling 24-hour change and a 24-hour sparkline for any mix of symbols. */
export default function Watchlist({ api, params }: IDockviewPanelProps<WatchlistParams>) {
  const items = instruments(params.symbols ?? DEFAULT_SYMBOLS);
  const [sources, setSources] = useState<Record<string, string>>({});
  const onSource = useCallback((id: string, source: string) => {
    setSources((current) => (current[id] === source ? current : { ...current, [id]: source }));
  }, []);
  useReportSources(api.id, Object.values(sources));

  return (
    <div className="h-full overflow-auto bg-panel">
      <div
        className={`grid h-(--row-h) ${COLUMNS} items-center gap-2 border-b border-line px-(--pad) text-label text-muted`}
      >
        <span>Symbol</span>
        <span>24h</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg 24h</span>
      </div>
      <ul>
        {items.map((item) => (
          <Row key={item.id} item={item} onSource={onSource} />
        ))}
      </ul>
    </div>
  );
}
