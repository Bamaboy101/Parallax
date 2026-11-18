import { useRef, useState } from 'react';
import '../../design/panels.css';
import '../../design/recorder.css';
import { useCursor } from '../../store/hooks';
import {
  endReplay,
  openRecording,
  pauseReplay,
  playReplay,
  recordingFile,
  recordingName,
  REPLAY_SPEEDS,
  startRecording,
  startReplay,
  stopRecording,
  useRecorder,
} from '../../store/recorder';
import { useNow } from '../useNow';

const when = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** 95_000 → '1:35', the length of a recording. */
const length = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
};

/** F10: record the session, save it as a file, replay a file through Rewind. */
export default function Recorder() {
  const { mode, startedAt, count, recording, replay, notice } = useRecorder();
  const [cursor] = useCursor();
  const now = useNow(1000);
  const file = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!recording) return;
    setSaving(true);
    try {
      const blob = await recordingFile(recording);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = recordingName(recording);
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="recorder-panel">
      {mode === 'recording' && startedAt !== null && (
        <section className="recorder-state" aria-label="Recording">
          <p className="recorder-status" data-term="Recording">
            <span className="recorder-dot" aria-hidden="true" />
            Recording · {length(now - startedAt)} · {count.toLocaleString()} market events
          </p>
          <button
            type="button"
            className="recorder-button"
            onClick={() => {
              stopRecording();
            }}
          >
            Stop
          </button>
        </section>
      )}

      {mode === 'replaying' && replay && (
        <section className="recorder-state" aria-label="Replay">
          <p className="recorder-status" data-term="Replay">
            Replaying {when.format(replay.from)} to {when.format(replay.to)}.{' '}
            {replay.playing
              ? `Playing at ${String(replay.speed)}×.`
              : cursor === null
                ? 'At the end of the recording: play again or drag Rewind.'
                : 'Paused: drag Rewind or play.'}
          </p>
          <div className="recorder-actions" role="group" aria-label="Play">
            {REPLAY_SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                className="chart-interval"
                aria-pressed={replay.playing && replay.speed === speed}
                onClick={() => {
                  playReplay(speed);
                }}
              >
                Play {speed}×
              </button>
            ))}
            <button
              type="button"
              className="chart-interval"
              disabled={!replay.playing}
              onClick={pauseReplay}
            >
              Pause
            </button>
          </div>
          <button
            type="button"
            className="recorder-button"
            onClick={() => {
              endReplay();
            }}
          >
            Back to live (reloads the page)
          </button>
        </section>
      )}

      {mode === 'idle' && (
        <section className="recorder-state" aria-label="Record">
          <button
            type="button"
            className="recorder-button"
            onClick={() => {
              startRecording();
            }}
          >
            Start recording
          </button>
          <p className="recorder-note">
            Keeps every market event this page receives, up to an hour. Open the panels whose
            markets you want in the recording first.
          </p>
        </section>
      )}

      {mode === 'idle' && recording && (
        <section className="recorder-state" aria-label="Recording ready">
          <p className="recorder-status" data-term="Session file">
            Ready: {when.format(recording.from)}, {length(recording.to - recording.from)} long,{' '}
            {recording.events.length.toLocaleString()} market events.
          </p>
          <div className="recorder-actions">
            <button
              type="button"
              className="recorder-button"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save as a file'}
            </button>
            <button
              type="button"
              className="recorder-button"
              onClick={() => {
                startReplay();
              }}
            >
              Replay
            </button>
          </div>
          <p className="recorder-note">
            Replay sets the live feeds aside and loads the recording into Rewind; going back to live
            reloads the page (your layout is kept).
          </p>
        </section>
      )}

      {mode === 'idle' && (
        <section className="recorder-state" aria-label="Open a file">
          <button
            type="button"
            className="recorder-button recorder-button--quiet"
            onClick={() => file.current?.click()}
          >
            Open a session file…
          </button>
          <input
            ref={file}
            type="file"
            accept=".gz,.json,application/gzip,application/json"
            hidden
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (chosen) void openRecording(chosen);
            }}
          />
        </section>
      )}

      {notice && (
        <p className="recorder-notice" role="status">
          {notice}
        </p>
      )}
      <p className="panel-footnote">
        Files hold market data as the feeds sent it, with their sources, and nothing else: no keys,
        settings or layout. Replayed panels say REPLAY on their badges.
      </p>
    </div>
  );
}
