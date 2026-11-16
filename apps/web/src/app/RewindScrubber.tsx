import { useEffect, useState } from 'react';
import { useCursor } from '../store/hooks';
import { HISTORY_SINCE, REWIND_MS } from '../store/ticks';

const STEP_MS = 5_000;

const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function ago(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`;
}

function useSecond(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return now;
}

/**
 * Rewind: drag the whole terminal back through the last hour — chart, book, tape, watchlist and
 * Constellation replay in sync. The right end, or the Live button, returns to live.
 */
export function RewindScrubber() {
  const [cursor, setCursor] = useCursor();
  const now = useSecond();
  const start = Math.max(HISTORY_SINCE, now - REWIND_MS);
  const value = cursor ?? now;
  const live = cursor === null;
  const label = live ? 'Live' : `−${ago(now - value)} · ${clock.format(value)}`;

  return (
    <div className={live ? 'rewind' : 'rewind is-rewound'}>
      <input
        type="range"
        className="rewind-track"
        min={start}
        max={now}
        step={STEP_MS}
        value={Math.max(start, value)}
        aria-label="Rewind the terminal"
        aria-valuetext={live ? 'Live' : `${ago(now - value)} ago, at ${clock.format(value)}`}
        disabled={now - start < STEP_MS}
        onChange={(event) => {
          const time = Number(event.target.value);
          setCursor(time >= now - STEP_MS ? null : time);
        }}
      />
      <span className="rewind-label" aria-live="polite">
        {label}
      </span>
      {!live && (
        <button
          type="button"
          className="rewind-live"
          onClick={() => {
            setCursor(null);
          }}
        >
          Back to live
        </button>
      )}
    </div>
  );
}
