import type { IDockviewPanelProps } from 'dockview-react';
import { Cell } from '../../design/Cell';
import { formatAge, formatCompact } from '../../design/format';
import '../../design/market.css';
import { failureNotice } from '../../design/notices';
import '../../design/onchain.css';
import { PanelNotice } from '../../design/PanelNotice';
import '../../design/panels.css';
import {
  ETHEREUM_SOURCE,
  FEAR_GREED_PAGE,
  FEAR_GREED_SOURCE,
  MEMPOOL_SOURCE,
  useOnchain,
  type Section,
} from '../../store/onchain/store';
import { useReportSources } from '../../store/panels';
import { useNow } from '../useNow';

const SOURCES = [MEMPOOL_SOURCE, ETHEREUM_SOURCE, FEAR_GREED_SOURCE];
/** A block holds about 1 vMB, so the queue in blocks is roughly its size in vMB. */
const BLOCK_VMB = 1;

/** A section's failure as a notice, only while it has nothing to show. */
function Waiting<T>({ section, what }: { section: Section<T>; what: string }) {
  if (section.data !== null) return null;
  if (section.failure) return <PanelNotice notice={failureNotice(section.failure, what)} compact />;
  return <p className="panel-empty">Loading {what}…</p>;
}

function Figure({
  term,
  label,
  children,
}: {
  term: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt data-term={term}>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** M5: Bitcoin fees and blocks, Ethereum gas, stablecoin supply on Ethereum, Fear & Greed. */
export default function OnchainPanel({ api }: IDockviewPanelProps) {
  const { bitcoin, ethereum, fearGreed } = useOnchain();
  useReportSources(api.id, SOURCES);
  const now = useNow(30_000);

  return (
    <div className="market-panel onchain-panel">
      <div className="panel-toolbar">
        <span className="panel-heading">On-chain</span>
        <span className="panel-caption">read by your browser · no key</span>
      </div>

      <section aria-label="Bitcoin">
        <h3 className="markets-group">Bitcoin · fee to confirm, sat/vB · mempool.space</h3>
        <Waiting section={bitcoin} what="Bitcoin fees" />
        {bitcoin.data && (
          <>
            <dl className="onchain-figures">
              <Figure term="Next block" label="Next block">
                <Cell value={bitcoin.data.fees.fastest} decimals={0} />
              </Figure>
              <Figure term="30 min" label="30 min">
                <Cell value={bitcoin.data.fees.halfHour} decimals={0} />
              </Figure>
              <Figure term="1 hour" label="1 hour">
                <Cell value={bitcoin.data.fees.hour} decimals={0} />
              </Figure>
              <Figure term="Economy" label="Economy">
                <Cell value={bitcoin.data.fees.economy} decimals={0} />
              </Figure>
            </dl>
            {bitcoin.data.mempool && (
              <p className="onchain-line" data-term="Mempool">
                <span className="onchain-line-label">Mempool</span>{' '}
                {formatCompact(bitcoin.data.mempool.count)} transactions waiting ·{' '}
                {bitcoin.data.mempool.vMB.toFixed(1)} vMB, about{' '}
                {String(Math.ceil(bitcoin.data.mempool.vMB / BLOCK_VMB))} blocks
              </p>
            )}
            {bitcoin.data.blocks.length > 0 && (
              <ul className="onchain-blocks" aria-label="Latest Bitcoin blocks">
                <li className="market-columns onchain-block-columns" aria-hidden="true">
                  <span>Block</span>
                  <span className="text-right">Age</span>
                  <span className="text-right">Txs</span>
                  <span className="text-right">Median fee</span>
                  <span>Pool</span>
                </li>
                {bitcoin.data.blocks.map((block) => (
                  <li key={block.height} className="market-row onchain-block-columns">
                    <span className="font-mono text-num">{block.height}</span>
                    <span className="text-right font-mono text-num text-muted">
                      {formatAge(Math.max(0, now - block.at))}
                    </span>
                    <Cell value={block.txCount} decimals={0} />
                    <Cell value={block.medianFee} decimals={0} />
                    <span className="onchain-pool">{block.pool ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-label="Ethereum">
        <h3 className="markets-group">Ethereum · gas, gwei · PublicNode</h3>
        <Waiting section={ethereum} what="Ethereum gas" />
        {ethereum.data && (
          <>
            <dl className="onchain-figures">
              <Figure term="Base fee" label="Base fee">
                <Cell value={ethereum.data.gas.baseFee} decimals={2} />
              </Figure>
              <Figure term="Slow" label="Slow">
                <Cell
                  value={ethereum.data.gas.baseFee + ethereum.data.gas.tips.slow}
                  decimals={2}
                />
              </Figure>
              <Figure term="Standard" label="Standard">
                <Cell
                  value={ethereum.data.gas.baseFee + ethereum.data.gas.tips.standard}
                  decimals={2}
                />
              </Figure>
              <Figure term="Fast" label="Fast">
                <Cell
                  value={ethereum.data.gas.baseFee + ethereum.data.gas.tips.fast}
                  decimals={2}
                />
              </Figure>
            </dl>
            <p className="onchain-line">
              <span className="onchain-line-label">Next block</span> after #
              {ethereum.data.gas.block}; tips are the last 5 blocks&apos; 25th, 50th and 75th
              percentile
            </p>
            <h3 className="markets-group" data-term="Stablecoin supply">
              Stablecoins on Ethereum · supply
            </h3>
            <dl className="onchain-figures onchain-supply">
              {ethereum.data.supply.map((coin) => (
                <Figure key={coin.symbol} term="Stablecoin supply" label={coin.symbol}>
                  <span className="font-mono text-num">{formatCompact(coin.supply)}</span>
                </Figure>
              ))}
            </dl>
            <p className="onchain-line">
              Tokens issued on Ethereum, read from each contract; supply on other chains is not
              counted.
            </p>
          </>
        )}
      </section>

      <section aria-label="Crypto Fear and Greed Index">
        <h3 className="markets-group">Crypto Fear &amp; Greed Index · daily</h3>
        <Waiting section={fearGreed} what="the Fear & Greed Index" />
        {fearGreed.data && (
          <div className="onchain-mood" data-term="Fear & Greed">
            <span className="onchain-mood-value font-mono">
              {fearGreed.data.value}
              <span className="text-muted">/100</span>
            </span>
            <span className="onchain-mood-label">{fearGreed.data.label}</span>
            {fearGreed.data.previous && (
              <span className="text-muted">
                yesterday {fearGreed.data.previous.value}, {fearGreed.data.previous.label}
              </span>
            )}
            <a className="onchain-credit" href={FEAR_GREED_PAGE} target="_blank" rel="noreferrer">
              Data from alternative.me
            </a>
          </div>
        )}
      </section>

      <p className="panel-footnote">
        DeFi totals and stablecoin supply across all chains are not shown: DefiLlama&apos;s terms
        allow personal, non-commercial use and bar republishing its data without permission, so they
        wait for its written permission. Fees and gas are what senders bid, not a price of Bitcoin
        or Ether.
      </p>
    </div>
  );
}
