import type { IDockviewPanelProps } from 'dockview-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { Cell } from '../../design/Cell';
import '../../design/market.css';
import '../../design/panels.css';
import { usePriceLine, useServingSource } from '../../store/hooks';
import { useKeyVault } from '../../store/keys';
import { useReportSources } from '../../store/panels';
import { instrument, type Instrument } from '../../store/symbols';
import { useVisibleRows } from '../useVisibleRows';
import { GROUPS, type BoardRow } from './meta';

const toneOf = (change: number | undefined) =>
  change === undefined || change === 0 ? 'neutral' : change > 0 ? 'up' : 'down';

/** How a row is served right now: the stream, the 15-second poller, or nothing yet. */
function feedLabel(source: string | undefined): { text: string; title: string } {
  if (source === undefined) return { text: '—', title: 'Not served yet: needs a key, or waiting' };
  if (source === 'alpaca-poll') {
    return {
      text: 'poll',
      title: 'Polled every 15 s: the stream is full, rows on screen go first',
    };
  }
  return { text: 'stream', title: `Streaming from ${source}` };
}

const Row = memo(function Row({
  item,
  row,
  visible,
  observe,
  onSource,
}: {
  item: Instrument;
  row: BoardRow;
  visible: boolean;
  observe: (element: HTMLElement | null) => void;
  onSource: (id: string, source: string | undefined) => void;
}) {
  const line = usePriceLine(item, !visible);
  const tone = toneOf(line.changePct);
  // Where the hub serves the row now; the last tick may predate a move between feeds.
  const source = useServingSource(item.id);
  const feed = feedLabel(source);
  useEffect(() => {
    onSource(item.id, source);
  }, [item.id, source, onSource]);

  return (
    <li
      ref={observe}
      data-row={item.id}
      className="market-row markets-columns"
      title={`${item.name} · ${item.note ?? 'proxy'}`}
    >
      <span className="markets-market">{row.market}</span>
      <span className="markets-proxy">
        <span className="market-symbol">{item.label}</span>
        <span className="markets-tag">proxy</span>
      </span>
      <span
        className={line.live ? 'text-right' : 'text-right opacity-60'}
        title={line.live ? undefined : 'Last hourly close; no live trade yet'}
      >
        <Cell value={line.price} decimals={item.decimals} pulse={line.live} />
      </span>
      <Cell value={line.changePct} decimals={2} signed suffix="%" tone={tone} />
      <span className="markets-feed" title={feed.title}>
        {feed.text}
      </span>
    </li>
  );
});

/**
 * World indices, US sectors, bonds and commodities through US-listed ETF proxies. Rows on screen
 * take the capped stream slots; the rest are polled.
 */
export default function Markets({ api }: IDockviewPanelProps) {
  const hasKey = useKeyVault(
    (state) => state.keys.alpaca !== undefined || state.keys.finnhub !== undefined,
  );
  const { root, row, isVisible } = useVisibleRows();
  const [sources, setSources] = useState<Record<string, string>>({});
  const onSource = useCallback((id: string, source: string | undefined) => {
    setSources((current) => {
      if (current[id] === source) return current;
      const others = Object.entries(current).filter(([key]) => key !== id);
      return Object.fromEntries(source === undefined ? others : [...others, [id, source]]);
    });
  }, []);
  useReportSources(api.id, Object.values(sources));

  return (
    <div ref={root} className="market-panel markets-panel">
      <div className="market-columns markets-columns">
        <span>Market</span>
        <span>Proxy</span>
        <span className="text-right">Last</span>
        <span className="text-right" title="Change since the previous session's close">
          Chg
        </span>
        <span className="text-right">Feed</span>
      </div>
      {!hasKey && (
        <p className="panel-empty">
          These are US-listed ETFs: add a free Alpaca or Finnhub key in Settings (the key icon in
          the top bar) to see them.
        </p>
      )}
      {GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="markets-group">{group.title}</h3>
          <ul>
            {group.rows.map((boardRow) => {
              const item = instrument(boardRow.id);
              return item ? (
                <Row
                  key={item.id}
                  item={item}
                  row={boardRow}
                  visible={isVisible(item.id)}
                  observe={row}
                  onSource={onSource}
                />
              ) : null;
            })}
          </ul>
        </section>
      ))}
      <p className="panel-footnote">
        Each row is a US-listed ETF standing in for its market (a proxy), so it trades New York
        hours: Japan, China, India, Germany and the UK show their moves during the US session. Bond
        ETFs are prices and fall when yields rise. Change is since the previous close. Rows on
        screen stream first; the rest are polled every 15 s once the 30-symbol stream is full.
      </p>
    </div>
  );
}
