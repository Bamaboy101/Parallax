import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { runCommand } from '../app/commands';
import { LAYOUT_PRESETS } from '../app/dockLayout';
import { WIDGETS } from '../app/widgets';
import type { WidgetMeta } from '../widgets/types';
import { suggest, type Command } from './parser';
import { closeCommandBar, openCommandBar, useCommandBar } from './state';
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

function Palette({ run, widgets, layouts }: PaletteProps) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const returnFocus = useRef<Element | null>(document.activeElement);
  const suggestions = useMemo(() => suggest(text, widgets, layouts), [text, widgets, layouts]);

  useEffect(
    () => () => {
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
          <kbd className="command-key" aria-hidden="true">
            /
          </kbd>
        </div>
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
