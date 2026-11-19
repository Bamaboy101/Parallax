import type { IDockviewPanelProps } from 'dockview-react';
import '../../design/corporate.css';
import '../../design/market.css';
import '../../design/panels.css';
import { Cell } from '../../design/Cell';
import { formatCompact, formatNumber } from '../../design/format';
import { failureNotice, type Notice } from '../../design/notices';
import { PanelNotice } from '../../design/PanelNotice';
import { plainName } from '../../design/plain';
import {
  EARNINGS_DAYS,
  EARNINGS_SOURCE,
  MARKET_EARNINGS,
  TRADE_CODES,
  useCorporate,
  type Earnings,
  type EarningsProblem,
  type HolderFiling,
  type InsiderFiling,
} from '../../store/corporate';
import { useReportSources } from '../../store/panels';
import { usePrefs } from '../../store/prefs';
import { instrument } from '../../store/symbols';

interface CorporateParams {
  symbol?: string;
}

const HOURS: Readonly<Record<Earnings['hour'], { label: string; plain: string }>> = {
  bmo: { label: 'Pre-market', plain: 'Before the market opens' },
  amc: { label: 'After close', plain: 'After the market closes' },
  dmh: { label: 'In hours', plain: 'During market hours' },
  '': { label: '—', plain: 'Time not given' },
};

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const day = (date: string) => dayFormat.format(Date.parse(`${date}T12:00:00Z`));

function earningsNotice(problem: EarningsProblem): Notice {
  switch (problem.kind) {
    case 'no-key':
      return {
        tone: 'info',
        title: 'Add a free Finnhub key to see earnings dates',
        detail: 'In Settings. Keys stay in this browser and go only to their provider.',
        action: 'settings',
      };
    case 'key-rejected':
      return {
        tone: 'warn',
        title: 'Finnhub rejected the stored key',
        detail: 'Check or replace it in Settings.',
        action: 'settings',
      };
    case 'failure':
      return failureNotice(problem.failure, 'Earnings dates');
  }
}

function EarningsRow({
  entry,
  simple,
  market,
}: {
  entry: Earnings;
  simple: boolean;
  market: boolean;
}) {
  const item = instrument(entry.symbol);
  const when = HOURS[entry.hour];
  return (
    <li className={`market-row corporate-earnings${market ? ' is-market' : ''}`}>
      <span className="corporate-date font-mono">{day(entry.date)}</span>
      {market && (
        <span className="corporate-name" title={item?.name}>
          {simple && item ? plainName(item) : entry.symbol}
        </span>
      )}
      <span title={when.plain}>{simple ? when.plain : when.label}</span>
      <Cell value={entry.epsEstimate} decimals={2} />
      {!market && (
        <span className="text-right font-mono">
          {entry.revenueEstimate === null ? '—' : `$${formatCompact(entry.revenueEstimate)}`}
        </span>
      )}
    </li>
  );
}

function EarningsHead({ market }: { market: boolean }) {
  return (
    <div className={`market-columns corporate-earnings${market ? ' is-market' : ''}`}>
      <span>Date</span>
      {market && <span>Company</span>}
      <span>When</span>
      <span>EPS est.</span>
      {!market && <span>Revenue est.</span>}
    </div>
  );
}

function InsiderRows({ filings, simple }: { filings: readonly InsiderFiling[]; simple: boolean }) {
  const rows = filings
    .flatMap((filing) => filing.trades.map((trade) => ({ filing, trade })))
    .slice(0, 15);
  if (rows.length === 0)
    return <p className="panel-empty">No insider trades in the latest Form 4 filings.</p>;
  return (
    <div className="corporate-table" tabIndex={0} aria-label="Insider trades table">
      <div className="market-columns corporate-insiders">
        <span>Date</span>
        <span>Who</span>
        <span>Trade</span>
        <span>Shares</span>
        <span>Price</span>
      </div>
      <ul>
        {rows.map(({ filing, trade }, index) => {
          const code = TRADE_CODES[trade.code];
          const label = code ? (simple ? code.plain : code.label) : trade.code;
          return (
            <li key={`${filing.url}-${String(index)}`} className="market-row corporate-insiders">
              <span className="font-mono">{trade.date.slice(5) || filing.filed.slice(5)}</span>
              <a
                className="corporate-name"
                href={filing.url}
                target="_blank"
                rel="noreferrer"
                title={`${filing.owner}${filing.role ? `, ${filing.role}` : ''} · filed ${filing.filed}`}
              >
                {filing.owner}
                {filing.role && <span className="corporate-role">{filing.role}</span>}
              </a>
              <span>
                {label}
                {filing.plan && (
                  <span className="corporate-plan" data-term="10b5-1">
                    10b5-1
                  </span>
                )}
              </span>
              <Cell value={trade.acquired ? trade.shares : -trade.shares} decimals={0} signed />
              <Cell value={trade.price} decimals={2} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HolderRows({ holders }: { holders: readonly HolderFiling[] }) {
  if (holders.length === 0)
    return <p className="panel-empty">No Schedule 13D or 13G filings on record.</p>;
  return (
    <div className="corporate-table" tabIndex={0} aria-label="Large holders table">
      <div className="market-columns corporate-holders">
        <span>Holder</span>
        <span>Stake</span>
        <span>Form</span>
        <span>Filed</span>
      </div>
      <ul>
        {holders.map((filing) => (
          <li key={filing.url} className="market-row corporate-holders">
            <a className="corporate-name" href={filing.url} target="_blank" rel="noreferrer">
              {filing.holder ?? 'Filer named in the document'}
            </a>
            <span className="text-right font-mono">
              {filing.percent === null ? '—' : `${formatNumber(filing.percent, 2)}%`}
            </span>
            <span className="corporate-form">{filing.form}</span>
            <span className="font-mono">{filing.filed}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * M7: a company's earnings date, insider trades and large holders; without a US stock, the
 * largest US companies reporting in the next two weeks.
 */
export default function Corporate({ api, params }: IDockviewPanelProps<CorporateParams>) {
  const item = params.symbol ? instrument(params.symbol) : undefined;
  const ticker = item?.kind === 'equity' ? item.base : null;
  const simple = usePrefs((state) => state.mode === 'simple');
  const corporate = useCorporate(ticker);
  useReportSources(api.id, ticker ? [EARNINGS_SOURCE, 'sec'] : [EARNINGS_SOURCE]);
  const market = ticker === null;
  const earnings = corporate.earnings ?? [];

  return (
    <div className="market-panel corporate-panel">
      {params.symbol && !ticker && (
        <p className="panel-empty">
          Corporate events are for US stocks; {item?.label ?? params.symbol} is not one. Showing the
          earnings calendar.
        </p>
      )}
      <section className="corporate-section" aria-label="Earnings">
        <h3 className="markets-group" data-term="Earnings">
          {market
            ? `${simple ? 'Results dates' : 'Earnings'} · largest ${String(MARKET_EARNINGS)}, next ${String(EARNINGS_DAYS)} days`
            : simple
              ? 'Next results date'
              : 'Next earnings'}
        </h3>
        {corporate.earningsProblem && (
          <PanelNotice
            notice={earningsNotice(corporate.earningsProblem)}
            compact={earnings.length > 0}
          />
        )}
        <div className="corporate-table" tabIndex={0} aria-label="Earnings calendar">
          <EarningsHead market={market} />
          <ul>
            {earnings.slice(0, market ? MARKET_EARNINGS : 2).map((entry) => (
              <EarningsRow
                key={`${entry.symbol}-${entry.date}`}
                entry={entry}
                simple={simple}
                market={market}
              />
            ))}
          </ul>
        </div>
        {corporate.earnings !== null && earnings.length === 0 && (
          <p className="panel-empty">
            {market
              ? 'No US company with a revenue estimate reports in the next two weeks.'
              : `No earnings date in the next ${String(EARNINGS_DAYS)} days.`}
          </p>
        )}
      </section>

      {ticker && (
        <>
          <section className="corporate-section" aria-label="Insider trades">
            <h3 className="markets-group" data-term="Insider trades">
              {simple ? 'Company insiders buying or selling' : 'Insider trades · Form 4'}
            </h3>
            {corporate.ownershipFailure && (
              <PanelNotice
                notice={failureNotice(corporate.ownershipFailure, 'SEC filings')}
                compact={corporate.ownership !== null}
              />
            )}
            {corporate.loading && !corporate.ownership && (
              <p className="panel-empty">Loading SEC filings…</p>
            )}
            {corporate.ownership && (
              <InsiderRows filings={corporate.ownership.insiders} simple={simple} />
            )}
          </section>
          <section className="corporate-section" aria-label="Large holders">
            <h3 className="markets-group" data-term="Large holders">
              {simple ? 'Big shareholders (over 5%)' : 'Large holders · 13D / 13G'}
            </h3>
            {corporate.ownership && <HolderRows holders={corporate.ownership.holders} />}
          </section>
        </>
      )}

      <p className="panel-footnote">
        Earnings dates and analysts&apos; average estimates: Finnhub, on your own key (it goes only
        to Finnhub).
        {market &&
          ' Without a company, the list keeps the US companies with the largest expected revenue.'}
        {ticker &&
          ' Insider trades and large holders: SEC EDGAR filings (Form 4; Schedules 13D and 13G), via the edge, cached 10 minutes. Shares are + bought or received, − sold or given up. Older 13G filings are documents without a machine-readable holder, so they link to the filing.'}{' '}
        Filings report what was done, not what will happen.
      </p>
    </div>
  );
}
