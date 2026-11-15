import { Cell } from '../../design/Cell';
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
    <li
      className="flex shrink-0 items-center gap-2"
      title={line.source ? `${item.name} · ${line.source}` : item.name}
    >
      <span className="text-label text-muted">{item.label}</span>
      <span className={line.live ? undefined : 'opacity-60'}>
        <Cell value={line.price} decimals={item.decimals} pulse={line.live} />
      </span>
      <Cell
        value={line.changePct}
        decimals={2}
        signed
        suffix="%"
        tone={tone}
        className="text-label"
      />
    </li>
  );
}

/** Bottom strip of headline instruments. */
export default function TickerRail() {
  return (
    <ul className="flex min-w-0 items-center gap-6 overflow-hidden">
      {instruments(RAIL_SYMBOLS).map((item) => (
        <Item key={item.id} item={item} />
      ))}
    </ul>
  );
}
