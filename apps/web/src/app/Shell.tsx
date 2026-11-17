import { useEffect, useState } from 'react';
import { CommandPalette, CommandTrigger } from '../command/CommandPalette';
import { OPEN_SETTINGS_EVENT } from '../design/settingsRequest';
import TickerRail from '../widgets/ticker-rail';
import { Clock } from './Clock';
import { runCommand } from './commands';
import { ConnectionStatus } from './ConnectionStatus';
import { DockArea } from './DockArea';
import { LearnLayer } from './LearnLayer';
import { LearnSwitch } from './LearnSwitch';
import { RenameBanner } from './RenameBanner';
import { isOldAddress } from './rename';
import { RewindScrubber } from './RewindScrubber';
import { useAlertEngine } from '../store/alerts/store';
import { useSoundLayer } from './sound';
import { useMarketWeather } from './weather';
import { widgetMeta } from './widgets';
import { WorkspaceMenu } from './WorkspaceMenu';

/** At the pre-rename address (until it closes), a banner row sits above the top bar. */
const OLD_ADDRESS = isOldAddress(window.location.origin);

function openSettings(): void {
  const settings = widgetMeta('settings');
  if (settings) runCommand({ kind: 'open', widget: settings });
}

/** Top bar, dock area, ticker rail. */
export function Shell() {
  useMarketWeather();
  // F7: alerts run whatever panels are open.
  useAlertEngine();
  // F12: cues for fired alerts and a lost network, when sound is switched on.
  useSoundLayer();
  // Panels ask for Settings (e.g. "Open Settings" on a no-key notice) through a window event.
  useEffect(() => {
    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings);
    };
  }, []);
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
      localStorage.setItem('parallax:theme', next);
    } catch {
      // The switch still works for this visit when storage is unavailable.
    }
  };

  return (
    <div
      className={`shell grid h-dvh bg-bg ${OLD_ADDRESS ? 'grid-rows-[auto_auto_minmax(0,1fr)_auto]' : 'grid-rows-[auto_minmax(0,1fr)_auto]'}`}
    >
      {OLD_ADDRESS && <RenameBanner />}
      <header className="shell-topbar">
        <div className="shell-brand">
          <div aria-hidden="true" className="shell-mark">
            <span />
          </div>
          <div className="shell-identity">
            <h1>Parallax</h1>
            <div className="shell-micro">Market operations</div>
          </div>
        </div>
        <div className="shell-command">
          <CommandTrigger />
        </div>
        <WorkspaceMenu />
        <div className="shell-tools">
          <RewindScrubber />
          <ConnectionStatus />
          <Clock />
          <LearnSwitch />
          <button
            type="button"
            className="theme-switch shell-settings"
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
            className="theme-switch shell-theme"
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
        <p className="shell-scroll-hint">Swipe across panels · all panels remain available</p>
      </header>
      <main
        aria-label="Market panels"
        tabIndex={0}
        className="shell-dock weather-glow min-h-0 min-w-0 p-2"
      >
        <DockArea />
      </main>
      <footer aria-label="Ticker rail" className="shell-rail">
        <TickerRail />
        <span className="shell-disclaimer">
          Market data as delivered by its sources · not investment advice
        </span>
      </footer>
      <CommandPalette />
      <LearnLayer />
    </div>
  );
}
