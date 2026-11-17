import { useState, type SyntheticEvent } from 'react';
import '../design/paper.css';
import { requestSettings } from '../design/settingsRequest';
import { useLastPrice } from '../store/hooks';
import { placePaperOrder, usePaperFeed, usePaperStore } from '../store/paper/store';
import { formatDuration, market, sessionState } from '../store/sessions';
import type { Instrument } from '../store/symbols';

/** When a day order sent now would start working, in words. */
function whenItWorks(now: number): string {
  const newYork = market('new-york');
  if (!newYork) return '';
  const state = sessionState(newYork, now);
  if (state.open || state.minutesToChange === undefined) return '';
  return ` New York is closed: a day order waits for the open in ${formatDuration(state.minutesToChange)}.`;
}

/**
 * A paper order ticket for one US stock or ETF: buy or sell, market or limit, whole shares, a
 * day order on Alpaca's paper account. Fake money; there is no live trading path.
 */
export function PaperTicket({ item, onClose }: { item: Instrument; onClose: () => void }) {
  usePaperFeed();
  const state = usePaperStore((paper) => paper.state);
  const last = useLastPrice(item);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [qty, setQty] = useState('1');
  const [limit, setLimit] = useState(() => (last ? last.price.toFixed(2) : ''));
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setResult(null);
    void placePaperOrder({
      symbol: item.id,
      side,
      type,
      qty: Number(qty),
      ...(type === 'limit' ? { limitPrice: Number(limit) } : {}),
    }).then((outcome) => {
      setSending(false);
      setResult(
        outcome.ok
          ? {
              ok: true,
              text:
                `Paper ${outcome.order.side} ${String(outcome.order.qty ?? qty)} ${outcome.order.symbol} ` +
                `${outcome.order.type === 'limit' ? `limit ${limit}` : 'at market'}: ${outcome.order.status}.` +
                whenItWorks(Date.now()),
            }
          : { ok: false, text: outcome.message },
      );
    });
  };

  return (
    <form className="paper-ticket" onSubmit={submit} aria-label={`Paper order for ${item.label}`}>
      <div className="paper-ticket-head">
        <strong>Paper order · {item.label}</strong>
        <span className="paper-ticket-tag">Fake money · Alpaca paper account</span>
        <button
          type="button"
          className="paper-ticket-close"
          aria-label="Close order ticket"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {state === 'no-key' ? (
        <p className="paper-ticket-note">
          Paper trading uses your free Alpaca paper key, the same one that streams US stocks.{' '}
          <button type="button" className="panel-notice-action" onClick={requestSettings}>
            Open Settings
          </button>
        </p>
      ) : state === 'live-key' ? (
        <p className="paper-ticket-note" data-tone="warn">
          The saved Alpaca key is a live-trading key, so it is never sent. Paper trading needs your
          paper key (it starts with PK).
        </p>
      ) : (
        <>
          <div className="paper-ticket-row" role="group" aria-label="Side">
            {(['buy', 'sell'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="chart-interval"
                aria-pressed={side === option}
                onClick={() => {
                  setSide(option);
                }}
              >
                {option === 'buy' ? 'Buy' : 'Sell'}
              </button>
            ))}
            {(['market', 'limit'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="chart-interval"
                aria-pressed={type === option}
                onClick={() => {
                  setType(option);
                  if (option === 'limit' && limit === '' && last) setLimit(last.price.toFixed(2));
                }}
              >
                {option === 'market' ? 'Market' : 'Limit'}
              </button>
            ))}
          </div>
          <div className="paper-ticket-row">
            <label>
              Shares
              <input
                inputMode="numeric"
                value={qty}
                onChange={(event) => {
                  setQty(event.target.value);
                }}
              />
            </label>
            {type === 'limit' && (
              <label>
                Limit $
                <input
                  inputMode="decimal"
                  value={limit}
                  onChange={(event) => {
                    setLimit(event.target.value);
                  }}
                />
              </label>
            )}
            <button type="submit" className="panel-notice-action" disabled={sending}>
              {sending ? 'Sending…' : `Place paper ${side}`}
            </button>
          </div>
          {result && (
            <p
              className="paper-ticket-note"
              role={result.ok ? 'status' : 'alert'}
              data-tone={result.ok ? 'info' : 'warn'}
            >
              {result.text}
            </p>
          )}
        </>
      )}
    </form>
  );
}
