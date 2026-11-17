import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cell } from '../../design/Cell';
import { formatCompact, formatNumber } from '../../design/format';
import '../../design/market.css';
import { failureNotice } from '../../design/notices';
import '../../design/options.css';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import {
  atTheMoney,
  chainRows,
  putCallRatio,
  smile,
  type ChainRow,
  type OptionQuote,
  type SmilePoint,
} from '../../store/options/parse';
import { OPTIONS_SOURCE, useOptions } from '../../store/options/store';
import { useReportSources } from '../../store/panels';
import { instrument } from '../../store/symbols';
import { useNow } from '../useNow';

interface OptionsParams {
  symbol?: string;
}

const SOURCES = [OPTIONS_SOURCE];
const DAY_MS = 86_400_000;
const expiryFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "20 Nov · 3 d": the expiry and the days left to it. */
function expiryLabel(expiry: string, now: number): string {
  const at = Date.parse(`${expiry}T00:00:00Z`);
  const days = Math.max(0, Math.ceil((at - now) / DAY_MS));
  return `${expiryFormat.format(at)} · ${String(days)} d`;
}

/**
 * One side of a strike as five direct row cells (bid, ask, IV, delta, volume), so each lines up
 * with its column heading and learn mode explains it by that heading.
 */
function Side({ quote, inTheMoney }: { quote: OptionQuote | null; inTheMoney: boolean }) {
  const cell = (column: string) => `options-cell ${column}${inTheMoney ? ' is-itm' : ''}`;
  return (
    <>
      <span className={cell('')}>
        <Cell value={quote?.bid} decimals={2} />
      </span>
      <span className={cell('')}>
        <Cell value={quote?.ask} decimals={2} />
      </span>
      <span className={cell('')}>
        <Cell value={quote?.iv == null ? null : quote.iv * 100} decimals={1} suffix="%" />
      </span>
      <span className={cell('options-delta')}>
        <Cell value={quote?.delta} decimals={2} signed />
      </span>
      <span className={cell('options-volume font-mono text-num')}>
        {quote && quote.volume > 0 ? formatCompact(quote.volume) : '—'}
      </span>
    </>
  );
}

function StrikeRow({ row, spot }: { row: ChainRow; spot: number }) {
  return (
    <div className="market-row options-row">
      <Side quote={row.call} inTheMoney={row.strike < spot} />
      <span className="options-strike font-mono text-num">{formatNumber(row.strike, 2)}</span>
      <Side quote={row.put} inTheMoney={row.strike > spot} />
    </div>
  );
}

const SMILE_W = 320;
const SMILE_H = 96;

/** Implied volatility across strikes, out-of-the-money side only, with the spot marked. */
function Smile({
  points,
  spot,
  sameDay,
}: {
  points: readonly SmilePoint[];
  spot: number;
  sameDay: boolean;
}) {
  if (points.length < 2) {
    return (
      <p className="panel-empty">
        {sameDay
          ? 'Alpaca gives no implied volatility for options expiring today; pick a later expiry to see the smile.'
          : 'Not enough implied-volatility readings to draw the smile.'}
      </p>
    );
  }
  const strikes = points.map((point) => point.strike);
  const ivs = points.map((point) => point.iv);
  const minK = Math.min(...strikes);
  const maxK = Math.max(...strikes);
  const minIv = Math.min(...ivs);
  const maxIv = Math.max(...ivs);
  const pad = Math.max((maxIv - minIv) * 0.1, 0.005);
  const x = (strike: number) => ((strike - minK) / (maxK - minK || 1)) * SMILE_W;
  const y = (iv: number) => (1 - (iv - (minIv - pad)) / (maxIv - minIv + 2 * pad)) * SMILE_H;
  const line = (type: SmilePoint['type']) =>
    points
      .filter((point) => point.type === type)
      .map((point) => `${x(point.strike).toFixed(1)},${y(point.iv).toFixed(1)}`)
      .join(' ');
  return (
    <figure className="options-smile">
      <div className="options-smile-heading">
        Volatility smile <span>OTM implied volatility</span>
      </div>
      <svg
        viewBox={`0 0 ${String(SMILE_W)} ${String(SMILE_H)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Implied volatility by strike"
      >
        {spot >= minK && spot <= maxK && (
          <line className="options-spot-line" x1={x(spot)} x2={x(spot)} y1={0} y2={SMILE_H} />
        )}
        <polyline className="options-smile-line is-put" points={line('put')} />
        <polyline className="options-smile-line" points={line('call')} />
      </svg>
      <figcaption className="options-legend">
        <span className="options-key is-put">Puts below spot</span>
        <span className="options-key">Calls at and above</span>
        <span className="options-axis">
          IV {formatNumber(minIv * 100, 0)}–{formatNumber(maxIv * 100, 0)}% · strikes{' '}
          {formatNumber(minK, 0)}–{formatNumber(maxK, 0)}
        </span>
      </figcaption>
    </figure>
  );
}

function Chain({ symbol }: { symbol: string }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const options = useOptions(symbol, chosen);
  const listRef = useRef<HTMLDivElement>(null);
  const spot = options.spot?.price ?? null;
  const rows = useMemo(() => chainRows(options.quotes), [options.quotes]);
  const atm = spot === null ? null : atTheMoney(rows, spot);
  const atmRow = rows.find((row) => row.strike === atm);
  const atmIv = atmRow?.call?.iv ?? atmRow?.put?.iv ?? null;
  const points = useMemo(() => (spot === null ? [] : smile(rows, spot)), [rows, spot]);
  const pc = useMemo(() => putCallRatio(options.quotes), [options.quotes]);
  const now = useNow(60_000);

  // Open each expiry centred on the spot.
  const centred = useRef<string | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list || rows.length === 0 || centred.current === options.expiry) return;
    const divider = list.querySelector<HTMLElement>('.options-spot');
    if (!divider) return;
    centred.current = options.expiry;
    list.scrollTop = divider.offsetTop - list.clientHeight / 2;
  }, [rows, options.expiry]);

  if (options.state === 'no-key') {
    return (
      <PanelNotice
        notice={{
          tone: 'info',
          title: 'Add your free Alpaca key to see options',
          detail:
            'Alpaca’s free plan includes its indicative options feed. The key stays in this browser and goes only to Alpaca.',
          action: 'settings',
        }}
      />
    );
  }

  return (
    <>
      <div className="options-expiries">
        <label className="options-expiry">
          <span>Expiry</span>
          <select
            value={options.expiry ?? ''}
            disabled={options.expiries.length === 0}
            onChange={(event) => {
              setChosen(event.target.value);
            }}
          >
            {options.expiries.length === 0 && <option value="">Loading…</option>}
            {options.expiries.map((expiry) => (
              <option key={expiry} value={expiry}>
                {expiryLabel(expiry, now)}
              </option>
            ))}
          </select>
        </label>
        <dl className="options-summary">
          <div>
            <dt>Spot</dt>
            <dd
              title={
                options.spot ? `IEX last trade at ${timeFormat.format(options.spot.at)}` : undefined
              }
            >
              <Cell value={spot} decimals={2} />
            </dd>
          </div>
          <div className="options-atm-summary">
            <dt>ATM IV</dt>
            <dd>
              <Cell value={atmIv === null ? null : atmIv * 100} decimals={1} suffix="%" />
            </dd>
          </div>
          <div className="options-ratio">
            <dt>Put/call</dt>
            <dd title="Puts traded per call in the session shown, this expiry">
              <Cell value={pc.ratio} decimals={2} />
            </dd>
          </div>
          <div>
            <dt>Volume</dt>
            <dd className="options-volumes">
              <span>{formatCompact(pc.callVolume)} calls</span>
              <span>{formatCompact(pc.putVolume)} puts</span>
            </dd>
          </div>
        </dl>
      </div>
      {options.failure && (
        <PanelNotice
          notice={failureNotice(options.failure, 'Alpaca options')}
          compact={rows.length > 0}
        />
      )}
      {options.state === 'loading' && <p className="panel-empty">Loading {symbol} options…</p>}
      {spot !== null && rows.length > 0 && (
        <Smile
          points={points}
          spot={spot}
          sameDay={
            options.expiry !== null && Date.parse(`${options.expiry}T23:59:59Z`) - now < DAY_MS
          }
        />
      )}
      {rows.length > 0 && spot !== null && (
        <>
          <div className="options-sides" aria-hidden="true">
            <span>Calls</span>
            <span className="options-strike-label">Strike</span>
            <span>Puts</span>
          </div>
          <div className="market-columns options-row">
            {['Bid', 'Ask', 'IV', 'Delta', 'Vol', 'Strike', 'Bid', 'Ask', 'IV', 'Delta', 'Vol'].map(
              (heading, index) => (
                <span
                  key={`${heading}-${String(index)}`}
                  className={
                    heading === 'Strike'
                      ? 'options-strike'
                      : `options-cell${heading === 'Delta' ? ' options-delta' : heading === 'Vol' ? ' options-volume' : ''}`
                  }
                >
                  {heading}
                </span>
              ),
            )}
          </div>
          <div ref={listRef} className="options-list">
            <ul>
              {rows.map((row, index) => {
                const previous = rows[index - 1];
                const spotHere =
                  previous !== undefined && previous.strike < spot && row.strike >= spot;
                return (
                  <li
                    className="options-strike-group"
                    data-atm={row.strike === atm}
                    key={row.strike}
                  >
                    {spotHere && (
                      <div className="options-spot" aria-label={`Spot ${formatNumber(spot, 2)}`}>
                        <span>Spot {formatNumber(spot, 2)}</span>
                      </div>
                    )}
                    <StrikeRow row={row} spot={spot} />
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
      {options.state === 'ready' &&
        options.expiry !== null &&
        rows.length === 0 &&
        !options.failure && (
          <p className="panel-empty">Loading the {expiryLabel(options.expiry, now)} chain…</p>
        )}
      {options.state === 'ready' && options.expiries.length === 0 && (
        <p className="panel-empty">No listed options for {symbol} in the next three months.</p>
      )}
    </>
  );
}

/**
 * Options on a US stock or ETF (M2): chain, implied-volatility smile and put/call ratio, from
 * Alpaca's free indicative feed on the user's key.
 */
export default function Options({ api, params }: IDockviewPanelProps<OptionsParams>) {
  useReportSources(api.id, SOURCES);
  const item = instrument(params.symbol ?? 'SPY');
  const equity = item?.kind === 'equity' ? item : undefined;
  return (
    <div className="market-panel options-panel">
      <div className="panel-toolbar">
        <span className="panel-heading">Options{equity ? ` · ${equity.label}` : ''}</span>
        <span className="panel-caption">Indicative · quotes adjusted · trades 15 min late</span>
        <span className="panel-caption">Not OPRA quotes</span>
      </div>
      {equity ? (
        // A new symbol starts fresh: its own expiries, the soonest first.
        <Chain key={equity.id} symbol={equity.id} />
      ) : (
        <p className="panel-empty">
          Options cover US stocks and ETFs. Try “options SPY” or “options AAPL” in the command bar.
        </p>
      )}
      <p className="panel-footnote">
        Alpaca’s free indicative feed: a derivative of the official OPRA feed, with quotes adjusted
        and trades delayed 15 minutes. IV and delta are Alpaca’s Black-Scholes values. The put/call
        ratio counts contracts traded in the latest session, this expiry only.
      </p>
    </div>
  );
}
