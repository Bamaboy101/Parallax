import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { runCommand } from '../app/commands';
import { LAYOUT_PRESETS } from '../app/dockLayout';
import { WIDGETS } from '../app/widgets';
import { usePrefs } from '../store/prefs';
import type { WidgetMeta } from '../widgets/types';
import { suggest, type Command } from './parser';
import {
  installLocal,
  listen,
  recognitionClass,
  routeFor,
  type Listening,
  type RecognitionConstructor,
} from './speech';
import { closeCommandBar, openCommandBar, useCommandBar } from './state';
import { normalizeSpoken } from './voice';
import '../design/command.css';

const EXAMPLES = [
  ['btc', 'Show BTC/USD in the active panel'],
  ['eth chart 1h', 'Open a 1-hour ETH/USD chart'],
  ['watch sol', 'Add SOL/USD to the watchlist'],
  ['news tesla', 'Search the headlines for Tesla'],
  ['layout crypto', 'Switch to the Crypto workspace'],
] as const;

function highlightMatch(label: string, query: string) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return label;
  const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return label
    .split(new RegExp(`(${pattern})`, 'gi'))
    .map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part));
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

interface PaletteProps {
  run: (command: Command) => boolean;
  widgets: readonly WidgetMeta[];
  layouts: readonly string[];
}

/**
 * Voice (F6), as the palette shows it:
 * - `checking`: asking the browser where recognition can run;
 * - `consent`: only the browser's online service is available, and the user has not agreed;
 * - `download`: on-device needs a one-time language download first;
 * - `listening`: the microphone is on; `heard` is what was recognised so far;
 * - `missed`: a final transcript that matched no command.
 */
type Voice =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'consent' }
  | { kind: 'download'; busy: boolean }
  | { kind: 'listening'; local: boolean; heard: string }
  | { kind: 'missed'; heard: string }
  | { kind: 'error'; message: string };

function MicIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2M5.5 14.5h5" />
    </svg>
  );
}

/** What the voice line under the query says, and which choices it offers. */
function VoiceLine({
  voice,
  onAgree,
  onDownload,
  onDismiss,
}: {
  voice: Voice;
  onAgree: () => void;
  onDownload: () => void;
  onDismiss: () => void;
}) {
  switch (voice.kind) {
    case 'idle':
      return null;
    case 'checking':
      return <p className="command-voice">Checking where this browser recognises speech…</p>;
    case 'listening':
      return (
        <p className="command-voice" data-state="listening" aria-live="polite">
          {voice.local
            ? 'Listening on this device'
            : 'Listening through the browser’s speech service'}
          {voice.heard === '' ? '… say a command' : `: “${voice.heard}”`}
        </p>
      );
    case 'missed':
      return (
        <p className="command-voice" aria-live="polite">
          Heard “{voice.heard}”: no matching symbol, widget or layout. Try again, or edit it.
        </p>
      );
    case 'error':
      return (
        <p className="command-voice" data-state="error" role="alert">
          {voice.message}
        </p>
      );
    case 'consent':
      return (
        <div className="command-voice" data-state="ask">
          <p>
            This browser cannot recognise speech on the device. To use voice, it sends what you say
            to its maker&apos;s online speech service, which turns it into text. Parallax never
            receives the audio. You can switch this off in Settings.
          </p>
          <div className="command-voice-actions">
            <button type="button" className="chart-interval" onClick={onAgree}>
              Use the online service
            </button>
            <button type="button" className="chart-interval" onClick={onDismiss}>
              Not now
            </button>
          </div>
        </div>
      );
    case 'download':
      return (
        <div className="command-voice" data-state="ask">
          <p>
            This browser can recognise speech on the device, so the audio never leaves it, after a
            one-time download of its English speech model.
          </p>
          <div className="command-voice-actions">
            <button
              type="button"
              className="chart-interval"
              disabled={voice.busy}
              onClick={onDownload}
            >
              {voice.busy ? 'Downloading…' : 'Download and listen'}
            </button>
            <button type="button" className="chart-interval" onClick={onDismiss}>
              Not now
            </button>
          </div>
        </div>
      );
  }
}

function Palette({ run, widgets, layouts }: PaletteProps) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const returnFocus = useRef<Element | null>(document.activeElement);
  const suggestions = useMemo(() => suggest(text, widgets, layouts), [text, widgets, layouts]);
  const recognizer = useMemo<RecognitionConstructor | undefined>(() => recognitionClass(), []);
  const [voice, setVoice] = useState<Voice>({ kind: 'idle' });
  const listening = useRef<Listening | null>(null);

  useEffect(
    () => () => {
      listening.current?.stop();
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
    },
    [],
  );

  const choose = (index: number) => {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    run(suggestion.command);
    closeCommandBar();
  };

  /** Listen once; the words become the query and the best match runs, as Enter would. */
  const hear = (Recognizer: RecognitionConstructor, local: boolean) => {
    setVoice({ kind: 'listening', local, heard: '' });
    listening.current = listen(Recognizer, local, {
      onText: (heard) => {
        setVoice({ kind: 'listening', local, heard });
      },
      onFinal: (heard) => {
        const words = normalizeSpoken(heard);
        setText(words);
        setSelected(0);
        const best = suggest(words, widgets, layouts)[0];
        if (best) {
          run(best.command);
          closeCommandBar();
        } else setVoice({ kind: 'missed', heard });
      },
      onError: (message) => {
        setVoice({ kind: 'error', message });
      },
      onEnd: () => {
        listening.current = null;
        setVoice((current) => (current.kind === 'listening' ? { kind: 'idle' } : current));
      },
    });
  };

  const startVoice = async (Recognizer: RecognitionConstructor) => {
    if (listening.current) {
      listening.current.stop();
      return;
    }
    setVoice({ kind: 'checking' });
    const route = await routeFor(Recognizer);
    if (route === 'local') hear(Recognizer, true);
    else if (route === 'download') setVoice({ kind: 'download', busy: false });
    else if (usePrefs.getState().voiceOnline) hear(Recognizer, false);
    else setVoice({ kind: 'consent' });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelected((index) => Math.min(index + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setSelected((index) => Math.max(index - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        choose(selected);
        break;
      case 'Escape':
        event.preventDefault();
        closeCommandBar();
        break;
    }
  };

  const optionId = (index: number) => `${listId}-${String(index)}`;

  return (
    <div
      className="command-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeCommandBar();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Command bar" className="command-surface">
        <div className="command-heading">
          <span className="command-heading-label">Command center</span>
          <span>Symbols · Widgets · Layouts</span>
        </div>
        <div className="command-query">
          <span className="command-prompt" aria-hidden="true">
            ›
          </span>
          <input
            autoFocus
            role="combobox"
            aria-label="Search symbols, widgets or commands"
            aria-expanded={suggestions.length > 0}
            aria-controls={listId}
            aria-activedescendant={suggestions.length > 0 ? optionId(selected) : undefined}
            aria-autocomplete="list"
            placeholder="Symbol, widget or command…"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            className="command-input"
          />
          {recognizer && (
            <button
              type="button"
              className="command-mic"
              aria-label={voice.kind === 'listening' ? 'Stop listening' : 'Speak a command'}
              title={voice.kind === 'listening' ? 'Stop listening' : 'Speak a command'}
              aria-pressed={voice.kind === 'listening'}
              onClick={() => {
                void startVoice(recognizer);
              }}
            >
              <MicIcon />
            </button>
          )}
          <kbd className="command-key" aria-hidden="true">
            /
          </kbd>
        </div>
        {recognizer && (
          <VoiceLine
            voice={voice}
            onAgree={() => {
              usePrefs.getState().setVoiceOnline(true);
              hear(recognizer, false);
            }}
            onDownload={() => {
              setVoice({ kind: 'download', busy: true });
              void installLocal(recognizer).then((installed) => {
                if (installed) hear(recognizer, true);
                else
                  setVoice({
                    kind: 'error',
                    message: 'The browser could not download its speech model. Try again later.',
                  });
              });
            }}
            onDismiss={() => {
              setVoice({ kind: 'idle' });
            }}
          />
        )}
        <div className="command-content">
          {text.trim() === '' ? (
            <ul className="command-examples">
              {EXAMPLES.map(([example, meaning]) => (
                <li key={example} className="command-example">
                  <span className="command-example-query">{example}</span>
                  <span>{meaning}</span>
                </li>
              ))}
            </ul>
          ) : suggestions.length === 0 ? (
            <p className="command-empty">No matching symbol, widget or layout.</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Suggestions" className="command-results">
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === selected}
                  onMouseMove={() => {
                    setSelected(index);
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(index);
                  }}
                  className="command-result"
                >
                  <span className="command-result-copy">
                    <span className="command-result-title">
                      {highlightMatch(suggestion.title, text)}
                    </span>
                    <span className="command-result-detail">
                      {highlightMatch(suggestion.detail, text)}
                    </span>
                  </span>
                  <kbd className="command-result-enter command-key" aria-hidden="true">
                    ↵
                  </kbd>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="command-footer">
          <span>
            <kbd className="command-key">↑</kbd>
            <kbd className="command-key">↓</kbd> Navigate
          </span>
          <span>
            <kbd className="command-key">↵</kbd> Run
          </span>
          <span>
            <kbd className="command-key">Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}

/** "/" or Ctrl/Cmd+K anywhere opens the command bar; keyboard only, results as you type. */
export function CommandPalette({
  run = runCommand,
  widgets = WIDGETS.map((widget) => widget.meta),
  layouts = Object.keys(LAYOUT_PRESETS),
}: Partial<PaletteProps>) {
  const open = useCommandBar((state) => state.open);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (shortcut || (event.key === '/' && !isEditable(event.target))) {
        event.preventDefault();
        if (shortcut && useCommandBar.getState().open) closeCommandBar();
        else openCommandBar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return open ? <Palette run={run} widgets={widgets} layouts={layouts} /> : null;
}

/** Top-bar entry point for mouse users. */
export function CommandTrigger() {
  return (
    <button
      type="button"
      onClick={openCommandBar}
      aria-label="Open command center"
      aria-keyshortcuts="/ Control+k Meta+k"
      className="command-trigger"
    >
      <span className="command-trigger-icon" aria-hidden="true">
        ⌕
      </span>
      <span className="truncate">Search or run a command</span>
      <kbd className="command-key" aria-hidden="true">
        /
      </kbd>
    </button>
  );
}
