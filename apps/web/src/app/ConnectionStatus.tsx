import { useShallow } from 'zustand/react/shallow';
import { sourceName } from '../design/sources';
import { useOnline } from '../store/network';
import { useTickStore } from '../store/ticks';

/**
 * Top-bar connection status: how many feeds are live, a notice when the network is gone or a
 * provider is rate limiting, and a warning when a free symbol cap leaves symbols waiting.
 */
export function ConnectionStatus() {
  const online = useOnline();
  const statuses = useTickStore(useShallow((state) => Object.values(state.status)));
  const live = statuses.filter((status) => status.state === 'live').length;
  const capped = statuses.filter((status) => status.waiting.length > 0);
  const limited = statuses.filter((status) => status.rateLimited);

  return (
    <div className="connection-status" role="status">
      {!online && (
        <span className="connection-offline" title="Feeds reconnect when the network is back">
          No network
        </span>
      )}
      {limited.map((status) => (
        <span
          key={`limit-${status.source}`}
          className="connection-cap"
          title={`${sourceName(status.source)} answered "too many requests". The terminal waits before asking again.`}
        >
          {sourceName(status.source)} rate limited
        </span>
      ))}
      {capped.map((status) => {
        const name = sourceName(status.source);
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
