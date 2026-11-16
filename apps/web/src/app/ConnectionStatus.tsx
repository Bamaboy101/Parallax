import { useShallow } from 'zustand/react/shallow';
import { useTickStore } from '../store/ticks';

const NAMES: Record<string, string> = {
  alpaca: 'Alpaca',
  finnhub: 'Finnhub',
  binance: 'Binance',
  coinbase: 'Coinbase',
  kraken: 'Kraken',
};

/**
 * Top-bar connection status: how many feeds are live, and a warning when a provider's free
 * symbol cap leaves symbols waiting.
 */
export function ConnectionStatus() {
  const statuses = useTickStore(useShallow((state) => Object.values(state.status)));
  const live = statuses.filter((status) => status.state === 'live').length;
  const capped = statuses.filter((status) => status.waiting.length > 0);

  return (
    <div className="connection-status" role="status">
      {capped.map((status) => {
        const name = NAMES[status.source] ?? status.source;
        const count = status.waiting.length;
        return (
          <span
            key={status.source}
            className="connection-cap"
            title={`${name}'s free plan streams ${String(status.symbolLimit)} symbols. Not streaming: ${status.waiting.join(', ')}. Close some, or add another provider's key in Settings.`}
          >
            {name} limit · {count} {count === 1 ? 'symbol' : 'symbols'} waiting
          </span>
        );
      })}
      <span className="connection-live" title="Feeds sending data now">
        <span
          aria-hidden="true"
          className={live > 0 ? 'connection-dot is-live' : 'connection-dot'}
        />
        {live} live
      </span>
    </div>
  );
}
