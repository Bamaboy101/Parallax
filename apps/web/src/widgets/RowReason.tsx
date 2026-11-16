import { Cell } from '../design/Cell';
import { availabilityLabel } from '../design/notices';
import '../design/panels.css';
import type { SymbolRef } from '../feeds/types';
import { useAvailability } from '../store/availability';

/**
 * In place of a missing price: why it is missing ('Needs key', 'Cap full', 'Offline'), with the
 * full sentence as a tooltip; an em dash while it is only connecting or quiet. Render it only
 * when the price is missing, so priced rows never subscribe to feed status.
 */
export function RowReason({ symbol, label }: { symbol: SymbolRef; label: string }) {
  const reason = availabilityLabel(useAvailability(symbol), label);
  if (!reason || reason.text === '…') return <Cell value={undefined} />;
  return (
    <span className="market-reason" data-tone={reason.tone} title={reason.title}>
      {reason.text}
    </span>
  );
}
