import { useEffect, useId, useMemo, useState } from 'react';
import { useCursor } from '../store/hooks';
import { HISTORY_SINCE, REWIND_MS, useTickStore } from '../store/ticks';

const STEP_MS = 5_000;
const TIMELINE_TICKS = [0, 0.25, 0.5, 0.75, 1];

interface TimelineSnapshot {
  now: number;
  observedSince: number;
  activity: readonly (readonly [number, number])[];
}

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

/** Count actual feed-store batches without subscribing React to the feed cadence. */
function useTimeline(): TimelineSnapshot {
  const [snapshot, setSnapshot] = useState<TimelineSnapshot>(() => {
    const now = Date.now();
    return { now, observedSince: now, activity: [] };
  });
  useEffect(() => {
    const observedSince = Date.now();
    const buckets = new Map<number, number>();
    const unsubscribe = useTickStore.subscribe((state, previous) => {
      // Cursor and source-status changes are not feed activity.
      if (state.versions === previous.versions) return;
      const bucket = Math.floor(Date.now() / STEP_MS) * STEP_MS;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    });
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const time of buckets.keys()) {
        if (time + STEP_MS <= now - REWIND_MS) buckets.delete(time);
      }
      setSnapshot({ now, observedSince, activity: [...buckets] });
    }, 1000);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, []);
  return snapshot;
}

/**
 * Rewind: drag the whole terminal back through the last hour — chart, book, tape, watchlist and
 * Constellation replay in sync. The right end, or the Live button, returns to live.
 */
export function RewindScrubber() {
  const [cursor, setCursor] = useCursor();
  const { now, observedSince, activity } = useTimeline();
  const descriptionId = useId();
  const start = Math.max(HISTORY_SINCE, now - REWIND_MS);
  const span = Math.max(1, now - start);
  const value = cursor ?? now;
  const live = cursor === null;
  const label = live ? 'Whole desk' : `−${ago(now - value)} · ${clock.format(value)}`;
  const activityPath = useMemo(() => {
    const peak = Math.max(1, ...activity.map(([, count]) => count));
    return activity
      .filter(([time]) => time + STEP_MS > start)
      .map(([time, count]) => {
        const midpoint = (Math.max(start, time) + Math.min(now, time + STEP_MS)) / 2;
        const x = (((midpoint - start) / span) * 200).toFixed(2);
        return `M ${x} 23 V ${(23 - (count / peak) * 18).toFixed(2)}`;
      })
      .join(' ');
  }, [activity, now, span, start]);
  const activityDescription = `Observed feed-store updates per 5 seconds since ${clock.format(observedSince)}; relative activity, not price or volume. No activity is inferred before observation.`;

  return (
    <div className={live ? 'rewind' : 'rewind is-rewound'}>
      <span className="rewind-mode" aria-live="polite">
        {live ? 'Live' : 'PAST'}
      </span>
      <div className="rewind-timeline" title={activityDescription}>
        <svg
          className="rewind-activity"
          viewBox="0 0 200 28"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <g className="rewind-ticks">
            {TIMELINE_TICKS.map((tick) => (
              <line key={tick} x1={tick * 200} y1={24} x2={tick * 200} y2={28} />
            ))}
          </g>
          <path d={activityPath} />
        </svg>
        <input
          type="range"
          className="rewind-track"
          min={start}
          max={now}
          step={STEP_MS}
          value={Math.max(start, value)}
          aria-label="Rewind the terminal"
          aria-describedby={descriptionId}
          aria-valuetext={live ? 'Live' : `${ago(now - value)} ago, at ${clock.format(value)}`}
          disabled={now - start < STEP_MS}
          onChange={(event) => {
            const time = Number(event.target.value);
            setCursor(time >= now - STEP_MS ? null : time);
          }}
        />
        <div className="rewind-axis" aria-hidden="true">
          <span>−{ago(now - start)}</span>
          <span>{activity.length === 0 ? 'No updates' : 'Store / 5s'}</span>
          <span>Now</span>
        </div>
      </div>
      <span id={descriptionId} hidden>
        {activityDescription}
      </span>
      <span className="rewind-label">{label}</span>
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
