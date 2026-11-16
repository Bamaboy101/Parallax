import { Cell } from '../../design/Cell';
import '../../design/market.css';
import { usePriceLine } from '../../store/hooks';
import { instruments, type Instrument } from '../../store/symbols';
import { RAIL_SYMBOLS } from './meta';

function Item({ item }: { item: Instrument }) {
  const line = usePriceLine(item);
  const tone =
    line.changePct === undefined || line.changePct === 0
      ? 'neutral'
      : line.changePct > 0
        ? 'up'
        : 'down';
  return (
    <li className="ticker-item" title={line.source ? `${item.name} · ${line.source}` : item.name}>
      <span className="ticker-symbol">{item.label}</span>
      <span className={line.live ? 'ticker-price' : 'ticker-price opacity-60'}>
        <Cell value={line.price} decimals={item.decimals} pulse={line.live} />
      </span>
      <Cell
        value={line.changePct}
        decimals={2}
        signed
        suffix="%"
        tone={tone}
        className="ticker-change"
      />
    </li>
  );
}

/** Bottom strip of headline instruments. */
export default function TickerRail() {
  return (
    <ul className="ticker-list" aria-label="Headline markets" tabIndex={0}>
      {instruments(RAIL_SYMBOLS).map((item) => (
        <Item key={item.id} item={item} />
      ))}
    </ul>
  );
}
