import { useState } from 'react';
import { CommandPalette, CommandTrigger } from '../command/CommandPalette';
import TickerRail from '../widgets/ticker-rail';
import { Clock } from './Clock';
import { runCommand } from './commands';
import { DockArea } from './DockArea';
import { widgetMeta } from './widgets';

function openSettings(): void {
  const settings = widgetMeta('settings');
  if (settings) runCommand({ kind: 'open', widget: settings });
}

/** Top bar, dock area, ticker rail. */
export function Shell() {
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  );

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    root.dataset.theme = next;
    root.style.colorScheme = next;
    root.style.removeProperty('background-color');
    setTheme(next);
    try {
      localStorage.setItem('open-terminal:theme', next);
    } catch {
      // The switch still works for this visit when storage is unavailable.
    }
  };

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] bg-bg">
      <header className="shell-topbar">
        <div aria-hidden="true" className="shell-mark">
          <span />
        </div>
        <h1 className="text-ui font-medium tracking-tight text-text">Open Terminal</h1>
        <div className="ml-4 min-w-0 flex-1 sm:max-w-80">
          <CommandTrigger />
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-4">
          <Clock />
          <button
            type="button"
            className="theme-switch"
            aria-label="Settings and data keys"
            title="Settings and data keys"
            onClick={openSettings}
          >
            <svg
              aria-hidden="true"
              focusable="false"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="15" r="4" />
              <path d="m10.8 12.2 9.2-9.2m-3 3 2.5 2.5m-5-0.5 2 2" />
            </svg>
          </button>
          <button
            type="button"
            className="theme-switch"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            onClick={toggleTheme}
          >
            <svg
              aria-hidden="true"
              focusable="false"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {theme === 'dark' ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
                </>
              ) : (
                <path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z" />
              )}
            </svg>
          </button>
        </div>
      </header>
      <main className="min-h-0 min-w-0 p-2">
        <DockArea />
      </main>
      <footer aria-label="Ticker rail" className="shell-rail">
        <TickerRail />
      </footer>
      <CommandPalette />
    </div>
  );
}
