import '../design/recorder.css';
import { endReplay, useRecorder } from '../store/recorder';

const when = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** F10: while a recorded session replays, every page says so, with the way back to live. */
export function ReplayBanner() {
  const replay = useRecorder((state) => state.replay);
  if (!replay) return null;
  return (
    <div className="replay-banner" role="status" aria-label="Session replay">
      <p>
        <strong>Replay</strong> of a session recorded {when.format(replay.from)}–
        {clock.format(replay.to)}. Prices, books and trades come from the recording; news, macro and
        other panels stay current.
      </p>
      <button
        type="button"
        className="replay-live"
        onClick={() => {
          endReplay();
        }}
      >
        Back to live
      </button>
    </div>
  );
}
