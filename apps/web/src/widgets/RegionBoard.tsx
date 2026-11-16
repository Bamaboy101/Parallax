import type { IDockviewPanelProps } from 'dockview-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Cell } from '../design/Cell';
import '../design/market.css';
import { availabilityNotice, failureNotice } from '../design/notices';
import { PanelNotice } from '../design/PanelNotice';
import '../design/panels.css';
import { useSharedAvailability } from '../store/availability';
import { usePriceLine, useServingSource } from '../store/hooks';
import { useReportSources } from '../store/panels';
import { instrument, instruments, type Instrument } from '../store/symbols';
import { OGDL_URL, TWSE_ATTRIBUTION, TWSE_SOURCE, useTaiex } from '../store/taiex';
import {
  LICENCE_NOTE,
  PROXY_LABEL,
  regionOpenNotice,
  type IndexRow,
  type RegionBoard as Board,
} from './regionBoards';
import { RowReason } from './RowReason';
import { useNow } from './useNow';
import { useVisibleRows } from './useVisibleRows';

const NOTICE_REFRESH_MS = 30_000;
const toneOf = (change: number | undefined) =>
  change === undefined || change === 0 ? 'neutral' : change > 0 ? 'up' : 'down';

/** A live Kraken pair: the region's market moving in its own hours. No pulse: lists stay still. */
const FxRow = memo(function FxRow({
  item,
  onSource,
}: {
  item: Instrument;
  onSource: (id: string, source: string | undefined) => void;
}) {
  const line = usePriceLine(item);
  const source = useServingSource(item.id);
  useEffect(() => {
    onSource(item.id, source);
  }, [item.id, source, onSource]);
  return (
    <li className="market-row region-columns" title={item.name}>
      <span className="market-symbol">{item.label}</span>
      <span className="region-source">live · Kraken</span>
      {line.price === undefined ? (
        <RowReason symbol={item} label={item.label} />
      ) : (
        <Cell value={line.price} decimals={item.decimals} />
      )}
      <Cell value={line.changePct} decimals={2} signed suffix="%" tone={toneOf(line.changePct)} />
    </li>
  );
});

const ProxyRow = memo(function ProxyRow({
  row,
  item,
  visible,
  observe,
  onSource,
}: {
  row: IndexRow;
  item: Instrument;
  visible: boolean;
  observe: (element: HTMLElement | null) => void;
  onSource: (id: string, source: string | undefined) => void;
}) {
  const line = usePriceLine(item, !visible);
  const source = useServingSource(item.id);
  useEffect(() => {
    onSource(item.id, source);
  }, [item.id, source, onSource]);
  return (
    <li
      ref={observe}
      data-row={item.id}
      className="market-row region-columns"
      title={`${row.index}: ${item.name}, ${PROXY_LABEL}. The ${LICENCE_NOTE}.`}
    >
      <span className="region-market">
        <span className="markets-market">{row.index}</span>
        <span className="region-note">{LICENCE_NOTE}</span>
      </span>
      <span className="region-source">
        <span className="market-symbol">{item.label}</span>
        <span className="markets-tag">{PROXY_LABEL}</span>
      </span>
      {line.price === undefined ? (
        <RowReason symbol={item} label={item.label} />
      ) : (
        <span
          className={line.live ? 'text-right' : 'text-right opacity-60'}
          title={line.live ? undefined : 'Last hourly close; no live trade yet'}
        >
          <Cell value={line.price} decimals={item.decimals} />
        </span>
      )}
      <Cell value={line.changePct} decimals={2} signed suffix="%" tone={toneOf(line.changePct)} />
    </li>
  );
});

const closeDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/** TAIEX's official daily close from TWSE open data. */
function TaiexRow({ index }: { index: string }) {
  const taiex = useTaiex();
  const date = taiex.latest ? closeDate.format(Date.parse(`${taiex.latest.date}T12:00:00Z`)) : '';
  return (
    <li
      className="market-row region-columns"
      title="Official close from the Taiwan Stock Exchange's open data"
    >
      <span className="region-market">
        <span className="markets-market">{index}</span>
        <span className="region-note">official close{date === '' ? '' : `, ${date}`}</span>
      </span>
      <span className="region-source">TWSE · end of day</span>
      {taiex.failure && !taiex.latest ? (
        <span
          className="market-reason"
          data-tone="offline"
          title={failureNotice(taiex.failure, 'TWSE').title}
        >
          Offline
        </span>
      ) : (
        <Cell value={taiex.latest?.close} decimals={2} />
      )}
      <Cell value={taiex.changePct} decimals={2} signed suffix="%" tone={toneOf(taiex.changePct)} />
    </li>
  );
}

/**
 * A region's board (M9): its live currencies first, then each index through a US-listed ETF
 * proxy, or an official level where a free licence allows it (TAIEX).
 */
export function RegionBoard({ api, board }: Pick<IDockviewPanelProps, 'api'> & { board: Board }) {
  const fx = useMemo(() => instruments(board.fx), [board]);
  const proxies = useMemo(
    () =>
      instruments(board.groups.flatMap((group) => group.rows.flatMap((row) => row.proxy ?? []))),
    [board],
  );
  const shared = useSharedAvailability(proxies);
  const keyNotice = useMemo(
    () => (shared ? availabilityNotice(shared, 'these ETFs') : null),
    [shared],
  );
  const now = useNow(NOTICE_REFRESH_MS);
  const openNotice = regionOpenNotice(board, now);
  const hasOfficial = board.groups.some((group) => group.rows.some((row) => row.official));

  const { root, row, isVisible } = useVisibleRows();
  const [sources, setSources] = useState<Record<string, string>>({});
  const onSource = useCallback((id: string, source: string | undefined) => {
    setSources((current) => {
      if (current[id] === source) return current;
      const others = Object.entries(current).filter(([key]) => key !== id);
      return Object.fromEntries(source === undefined ? others : [...others, [id, source]]);
    });
  }, []);
  useReportSources(
    api.id,
    hasOfficial ? [...Object.values(sources), TWSE_SOURCE] : Object.values(sources),
  );

  return (
    <div ref={root} className="market-panel markets-panel">
      <section aria-label={`${board.title} currencies`}>
        <h3 className="markets-group">Currencies · live in {board.title} hours</h3>
        <ul>
          {fx.map((item) => (
            <FxRow key={item.id} item={item} onSource={onSource} />
          ))}
        </ul>
      </section>
      {openNotice && (
        <p className="region-open" role="status">
          {openNotice}
        </p>
      )}
      <div className="market-columns region-columns">
        <span>Index</span>
        <span>Source</span>
        <span className="text-right">Last</span>
        <span className="text-right" title="Change since the previous close">
          Chg
        </span>
      </div>
      {keyNotice && <PanelNotice notice={keyNotice} compact />}
      {board.groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="markets-group">{group.title}</h3>
          <ul>
            {group.rows.map((indexRow) => {
              if (indexRow.official === 'taiex')
                return <TaiexRow key={indexRow.key} index={indexRow.index} />;
              const item = indexRow.proxy === undefined ? undefined : instrument(indexRow.proxy);
              return item ? (
                <ProxyRow
                  key={indexRow.key}
                  row={indexRow}
                  item={item}
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
        Free index levels for this region need a licence from each index provider, so rows show
        US-listed ETF proxies, which trade New York hours only; during the region&apos;s own hours
        the currency rows above are what moves.
        {hasOfficial && (
          <>
            {' '}
            TAIEX: {TWSE_ATTRIBUTION}{' '}
            <a href={OGDL_URL} target="_blank" rel="noreferrer">
              Open Government Data License
            </a>
          </>
        )}
      </p>
    </div>
  );
}
