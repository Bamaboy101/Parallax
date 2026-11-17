import { create } from 'zustand';

/**
 * E6 Installable app. The offline shell (`public/sw.js`) is registered in production builds; the
 * browser's install prompt is kept here so Settings can offer "Install Parallax" when it exists.
 */

/** Chromium's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  /** The saved prompt, while the browser offers installation. */
  prompt: InstallPromptEvent | null;
  /** Running as an installed app (its own window). */
  installed: boolean;
}

export const useInstall = create<InstallState>()(() => ({ prompt: null, installed: false }));

const standalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // iOS Safari's own flag for a home-screen app.
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Called once at start: register the offline shell and listen for the install prompt. */
export function setUpInstall(production: boolean): void {
  useInstall.setState({ installed: standalone() });
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-bar from appearing; Settings offers it instead.
    event.preventDefault();
    useInstall.setState({ prompt: event as InstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    useInstall.setState({ prompt: null, installed: true });
  });
  if (production && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js');
    });
  }
}

/** Show the browser's install dialog; the prompt can be used only once. */
export async function install(): Promise<void> {
  const { prompt } = useInstall.getState();
  if (!prompt) return;
  useInstall.setState({ prompt: null });
  await prompt.prompt();
}

/** iPhone and iPad Safari install from the Share menu; there is no prompt to show. */
export const isAppleMobile = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent);
