import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { create } from 'zustand';
import { isObject } from '../feeds/adapters/parse';
import { HISTORY_SINCE, setCursor } from '../store/ticks';

/** A saved or shared workspace: the dock, and the Rewind moment it was looking at, if any. */
export interface WorkspaceFile {
  app: 'parallax';
  kind: 'workspace';
  v: 1;
  dock: SerializedDockview;
  /** Rewind moment (epoch ms); absent when live. */
  at?: number;
}

/** The URL hash key for a shared workspace: `#w=<deflated, base64url JSON>`. */
export const SHARE_KEY = 'w';

export function workspaceFile(api: DockviewApi, at: number | null): WorkspaceFile {
  return {
    app: 'parallax',
    kind: 'workspace',
    v: 1,
    dock: api.toJSON(),
    ...(at === null ? {} : { at }),
  };
}

/** A dockview layout has a grid and a panels map; anything else is not a layout. */
function isDock(value: unknown): value is SerializedDockview {
  return isObject(value) && isObject(value.grid) && isObject(value.panels);
}

/** Files and share links made before the rename (18 Nov 2026) say 'open-terminal'. */
const APPS = new Set<unknown>(['parallax', 'open-terminal']);

/** Read a workspace file, or a bare dockview layout; null for anything else. */
export function parseWorkspace(value: unknown): WorkspaceFile | null {
  if (isDock(value)) return { app: 'parallax', kind: 'workspace', v: 1, dock: value };
  if (!isObject(value) || !APPS.has(value.app) || value.kind !== 'workspace') return null;
  if (!isDock(value.dock)) return null;
  const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : undefined;
  return {
    app: 'parallax',
    kind: 'workspace',
    v: 1,
    dock: value.dock,
    ...(at === undefined ? {} : { at }),
  };
}

/**
 * Put a workspace on the dock. If it does not load (a widget this version lacks, a broken file),
 * the dock goes back to what it showed before and this returns false.
 */
export function loadWorkspace(api: DockviewApi, file: WorkspaceFile): boolean {
  const before = api.toJSON();
  try {
    api.fromJSON(file.dock);
    if (api.panels.length > 0) return true;
  } catch {
    // Fall through and restore the previous layout.
  }
  api.fromJSON(before);
  return false;
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const body = new Response(bytes).body;
  if (!body) throw new Error('no stream');
  return new Uint8Array(await new Response(body.pipeThrough(stream)).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Compress a workspace into a URL-safe token. */
export async function encodeShare(file: WorkspaceFile): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(file));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** Read a token from a share link; null when it is damaged or not a workspace. */
export async function decodeShare(token: string): Promise<WorkspaceFile | null> {
  try {
    const json = await pipe(fromBase64Url(token), new DecompressionStream('deflate-raw'));
    return parseWorkspace(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}

/** The share token in a URL hash, if there is one. */
export function shareToken(hash: string): string | undefined {
  return new URLSearchParams(hash.replace(/^#/, '')).get(SHARE_KEY) ?? undefined;
}

export function shareUrl(location: Pick<Location, 'origin' | 'pathname'>, token: string): string {
  return `${location.origin}${location.pathname}#${SHARE_KEY}=${token}`;
}

/** The latest workspace message for the top bar ("Share link copied", a failed import, ...). */
export const useWorkspaceNotice = create<{ notice: string | null }>()(() => ({ notice: null }));

export function notify(notice: string | null): void {
  useWorkspaceNotice.setState({ notice });
}

const moment = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Open a workspace shared in the URL hash, then drop the hash so a reload shows the user's own
 * layout. A shared Rewind moment is applied only if this page has data for it: Rewind replays
 * what this browser has seen since it opened, and nothing is stored on a server.
 */
export async function openSharedWorkspace(
  api: DockviewApi,
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): Promise<void> {
  const token = shareToken(location.hash);
  if (!token) return;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  const file = await decodeShare(token);
  if (!file || !loadWorkspace(api, file)) {
    notify('This share link is damaged or needs a newer version; your own layout is shown.');
    return;
  }
  if (file.at === undefined) {
    notify('Opened a shared workspace.');
  } else if (file.at >= HISTORY_SINCE) {
    setCursor(file.at);
    notify(`Opened a shared workspace at ${moment.format(file.at)}.`);
  } else {
    notify(
      `This link points to ${moment.format(file.at)}, before this page opened. Rewind only replays what this browser has seen, so the panels are live.`,
    );
  }
}
