import './app/storageMigration';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { App } from './app/App';
import { receiveHandoff, withoutHandoff } from './app/rename';
import './index.css';
import { applyPrefs, usePrefs } from './store/prefs';
import { SHARE_KEY } from './app/workspace';

function render(): void {
  applyPrefs();
  // A shared workspace link opens in the cockpit, where the dock can load it.
  if (new URLSearchParams(window.location.hash.slice(1)).has(SHARE_KEY)) {
    usePrefs.getState().setView('cockpit');
  }
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Opened by the old address's "Move" button: take its saved entries before anything renders (and
// so before anything saves), then load again with them.
const handoff = receiveHandoff();
if (handoff) {
  void handoff.then((moved) => {
    const href = withoutHandoff(window.location.href);
    if (moved) {
      window.location.replace(href);
      return;
    }
    window.history.replaceState(null, '', href);
    render();
  });
} else {
  render();
}
