import { isObject } from '../feeds/adapters/parse';

/**
 * The move (18 Nov 2026): Open Terminal became Parallax Terminal, at a new address. Both earlier
 * addresses (the original open-terminal and the short-lived parallax-markets) serve the same app
 * with a banner until 18 Dec 2026.
 */
export const NEW_ORIGIN = 'https://parallax-terminal.pages.dev';
export const OPEN_TERMINAL_ORIGIN = 'https://open-terminal.pages.dev';
export const OLD_ORIGINS: readonly string[] = [
  OPEN_TERMINAL_ORIGIN,
  'https://parallax-markets.pages.dev',
];
export const OLD_ADDRESS_CLOSES = '18 December 2026';

const OLD_PREFIX = 'open-terminal:';
const PREFIX = 'parallax:';
const HANDOFF_PARAM = 'handoff';
const READY = 'parallax:handoff-ready';
const ENTRIES = 'parallax:handoff-entries';
/** How long the new address waits for the old one to answer before opening as usual. */
export const HANDOFF_TIMEOUT_MS = 5_000;
/** More entries than the app ever stores means the message is not ours. */
const MAX_ENTRIES = 50;

/**
 * Same address, new names: every `open-terminal:*` entry becomes `parallax:*`, unless the new one
 * already exists (it is newer). Runs before any store reads its saved state.
 */
export function migrateStorage(storage: Storage): void {
  const old: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(OLD_PREFIX)) old.push(key);
  }
  for (const key of old) {
    const value = storage.getItem(key);
    const renamed = PREFIX + key.slice(OLD_PREFIX.length);
    if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value);
    storage.removeItem(key);
  }
}

export function isOldAddress(origin: string): boolean {
  return OLD_ORIGINS.includes(origin);
}

/** This app's saved entries (layout, preferences, alerts, keys), to carry to the new address. */
function savedEntries(storage: Storage): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    const value = key === null ? null : storage.getItem(key);
    if (key?.startsWith(PREFIX) && value !== null) entries[key] = value;
  }
  return entries;
}

/** The entries in a handoff message, or null for anything that is not one. */
export function handoffEntries(data: unknown): [string, string][] | null {
  if (!isObject(data) || data.type !== ENTRIES || !isObject(data.entries)) return null;
  const entries = Object.entries(data.entries);
  if (entries.length > MAX_ENTRIES) return null;
  const valid = entries.filter(
    (entry): entry is [string, string] =>
      entry[0].startsWith(PREFIX) && typeof entry[1] === 'string',
  );
  return valid.length === entries.length ? valid : null;
}

/**
 * Old address, on the user's click: open the new address and, when it says it is ready, hand it
 * this browser's saved entries. Storage is per address, so this is the only way a layout and keys
 * cross over. They go window to window inside this browser, to our own new address only; nothing
 * is sent over the network.
 */
export function sendHandoff(win: Window = window): boolean {
  const target = win.open(`${NEW_ORIGIN}/?${HANDOFF_PARAM}=1`, '_blank');
  if (!target) return false;
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== NEW_ORIGIN || event.source !== target) return;
    if (!isObject(event.data) || event.data.type !== READY) return;
    win.removeEventListener('message', onMessage);
    target.postMessage({ type: ENTRIES, entries: savedEntries(win.localStorage) }, NEW_ORIGIN);
  };
  win.addEventListener('message', onMessage);
  return true;
}

/**
 * New address, opened by the old one's "Move" button: ask the opener for its entries and save
 * them. Resolves true once they are saved, false if none arrive in time; null when this page was
 * not opened for a handoff.
 */
export function receiveHandoff(win: Window = window): Promise<boolean> | null {
  const opener = win.opener as Window | null;
  if (!new URL(win.location.href).searchParams.has(HANDOFF_PARAM) || !opener) return null;
  return new Promise((resolve) => {
    const finish = (moved: boolean) => {
      win.removeEventListener('message', onMessage);
      win.clearTimeout(timer);
      resolve(moved);
    };
    const onMessage = (event: MessageEvent) => {
      if (!OLD_ORIGINS.includes(event.origin) || event.source !== opener) return;
      const entries = handoffEntries(event.data);
      if (!entries) return;
      for (const [key, value] of entries) win.localStorage.setItem(key, value);
      finish(true);
    };
    win.addEventListener('message', onMessage);
    const timer = win.setTimeout(() => {
      finish(false);
    }, HANDOFF_TIMEOUT_MS);
    // The opener is one of the old addresses; each post reaches it only at its own origin.
    for (const origin of OLD_ORIGINS) opener.postMessage({ type: READY }, origin);
  });
}

/** The address without `?handoff`, so a reload does not ask again. */
export function withoutHandoff(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(HANDOFF_PARAM);
  return url.toString();
}
