import '../design/market.css';
import { availabilityNotice } from '../design/notices';
import { PanelNotice } from '../design/PanelNotice';
import type { Instrument } from '../store/symbols';
import { useAvailability } from '../store/availability';

/**
 * A single-symbol panel with no data yet: why (no key, cap full, rate limited, offline), or
 * `waiting` while a feed is connecting or the symbol simply has not traded since the page opened.
 */
export function SymbolNotice({ item, waiting }: { item: Instrument; waiting: string }) {
  const availability = useAvailability(item);
  const notice =
    availability.kind === 'starting' || availability.kind === 'connecting'
      ? null
      : availabilityNotice(availability, item.label);
  if (!notice) return <p className="market-empty">{waiting}</p>;
  return <PanelNotice notice={notice} />;
}
