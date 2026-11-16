import type { IDockviewPanelProps } from 'dockview-react';
import { Badge } from '../../design/Badge';
import { Cell } from '../../design/Cell';
import '../../design/market.css';
import '../../design/panels.css';
import { useEcbRates } from '../../store/ecb';
import { usePriceLine } from '../../store/hooks';
import { useFreshness, useReportSources } from '../../store/panels';
import { INSTRUMENTS, type Instrument } from '../../store/symbols';

const LIVE_PAIRS = INSTRUMENTS.filter((item) => item.kind === 'fx');

const toneOf = (change: number | undefined) =>
  change === undefined || change === 0 ? 'neutral' : change > 0 ? 'up' : 'down';

/** Decimals that keep about five significant figures for a rate of this size. */
const decimalsFor = (value: number) => (value >= 1000 ? 1 : value >= 100 ? 2 : value >= 10 ? 3 : 4);

function LivePair({ item }: { item: Instrument }) {
  const line = usePriceLine(item);
  return (
    <li className="market-row fx-columns" title={`${item.label}: mid of Kraken's best bid and ask`}>
      <span className="market-symbol">{item.label}</span>
      <span
        className={line.live ? 'text-right' : 'text-right opacity-60'}
        title={line.live ? undefined : 'Last hourly close; no live quote yet'}
      >
        <Cell value={line.price} decimals={item.decimals} pulse={line.live} />
      </span>
      <Cell value={line.changePct} decimals={2} signed suffix="%" tone={toneOf(line.changePct)} />
    </li>
  );
}

function SectionHead({ title, source, note }: { title: string; source: string; note?: string }) {
  const [freshness] = useFreshness([source]);
  return (
    <div className="fx-heading">
      <h3 className="markets-group">{title}</h3>
      {note && <span className="derivs-muted">{note}</span>}
      {freshness && <Badge freshness={freshness} source={source} />}
    </div>
  );
}

/**
 * FX in two honest halves: Kraken's live pairs (streamed mid prices) and the ECB's daily
 * reference rates for about 30 currencies against the dollar, each section with its own badge.
 */
export default function Fx({ api }: IDockviewPanelProps) {
  const ecb = useEcbRates();
  useReportSources(api.id, ['kraken', 'ecb']);

  return (
    <div className="market-panel fx-panel">
      <SectionHead title="Live pairs" source="kraken" />
      <div className="market-columns fx-columns">
        <span>Pair</span>
        <span className="text-right">Mid</span>
        <span className="text-right" title="24-hour change">
          Chg
        </span>
      </div>
      <ul>
        {LIVE_PAIRS.map((item) => (
          <LivePair key={item.id} item={item} />
        ))}
      </ul>

      <SectionHead
        title="ECB reference rates"
        source="ecb"
        note={ecb.data ? `fixing of ${ecb.data.date}` : undefined}
      />
      <div className="market-columns fx-columns">
        <span>Currency</span>
        <span className="text-right">1 USD =</span>
        <span
          className="text-right"
          title="The currency against the dollar since the previous fixing"
        >
          Chg
        </span>
      </div>
      {ecb.state === 'loading' && <p className="panel-empty">Loading the ECB's rates…</p>}
      {ecb.state === 'error' && (
        <p className="panel-empty">ECB rates are unavailable right now ({ecb.error}).</p>
      )}
      {ecb.data && (
        <ul>
          {ecb.data.rates.map((rate) => (
            <li key={rate.code} className="market-row fx-columns" title={rate.name}>
              <span className="fx-currency">
                <span className="market-symbol">{rate.code}</span>
                <span className="fx-name">{rate.name}</span>
              </span>
              <Cell value={rate.perUsd} decimals={decimalsFor(rate.perUsd)} />
              <Cell
                value={rate.changePct}
                decimals={2}
                signed
                suffix="%"
                tone={toneOf(rate.changePct)}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="panel-footnote">
        Live pairs: mid of Kraken's best bid and ask, change over 24 hours. ECB rates: the euro
        reference rates the European Central Bank fixes once a working day around 16:00 CET (via
        Frankfurter), restated against the dollar; for reference, not for trading.
      </p>
    </div>
  );
}
