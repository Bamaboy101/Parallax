import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { runCommand } from '../app/commands';
import { LAYOUT_PRESETS } from '../app/dockLayout';
import { WIDGETS } from '../app/widgets';
import type { WidgetMeta } from '../widgets/types';
import { suggest, type Command } from './parser';
import { closeCommandBar, openCommandBar, useCommandBar } from './state';

const EXAMPLES = [
  ['btc', 'Show BTC/USD in the active panel'],
  ['eth chart 1h', 'Open a 1-hour ETH/USD chart'],
  ['watch sol', 'Add SOL/USD to the watchlist'],
  ['eur book', 'Open the EUR/USD order book'],
  ['layout default', 'Reset the panels'],
] as const;

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
      className="fixed inset-0 z-[1000] flex justify-center bg-bg/60 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeCommandBar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
        className="h-fit w-[min(560px,92vw)] overflow-hidden rounded-panel border border-line bg-panel"
      >
        <input
          autoFocus
          role="combobox"
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
          className="h-11 w-full border-b border-line bg-transparent px-4 text-ui text-text outline-none placeholder:text-muted"
        />
        {text.trim() === '' ? (
          <ul className="py-2">
            {EXAMPLES.map(([example, meaning]) => (
              <li key={example} className="flex gap-3 px-4 py-1 text-label">
                <span className="w-28 font-mono text-text">{example}</span>
                <span className="text-muted">{meaning}</span>
              </li>
            ))}
          </ul>
        ) : suggestions.length === 0 ? (
          <p className="px-4 py-3 text-label text-muted">No matching symbol, widget or layout.</p>
        ) : (
          <ul
            id={listId}
            role="listbox"
            aria-label="Suggestions"
            className="max-h-80 overflow-auto py-1"
          >
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
                className={`flex cursor-pointer items-baseline justify-between gap-4 px-4 py-2 ${
                  index === selected ? 'bg-line' : ''
                }`}
              >
                <span className="text-ui text-text">{suggestion.title}</span>
                <span className="truncate text-label text-muted">{suggestion.detail}</span>
              </li>
            ))}
          </ul>
        )}
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
      className="flex h-7 min-w-0 items-center gap-6 rounded-panel border border-line bg-panel px-3 text-label text-muted hover:text-text"
    >
      <span className="truncate">Search or run a command</span>
      <kbd className="font-mono text-muted">/</kbd>
    </button>
  );
}
