import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HANDOFF_TIMEOUT_MS,
  NEW_ORIGIN,
  OLD_ORIGINS,
  OPEN_TERMINAL_ORIGIN,
  isOldAddress,
  handoffEntries,
  migrateStorage,
  receiveHandoff,
  sendHandoff,
  withoutHandoff,
} from './rename';

describe('migrateStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renames every open-terminal entry and leaves others alone', () => {
    localStorage.setItem('open-terminal:layout', '{"dock":1}');
    localStorage.setItem('open-terminal:keys', '{"alpaca":"k"}');
    localStorage.setItem('other-app:thing', 'x');
    migrateStorage(localStorage);
    expect(localStorage.getItem('parallax:layout')).toBe('{"dock":1}');
    expect(localStorage.getItem('parallax:keys')).toBe('{"alpaca":"k"}');
    expect(localStorage.getItem('open-terminal:layout')).toBeNull();
    expect(localStorage.getItem('other-app:thing')).toBe('x');
  });

  it('keeps an entry already saved under the new name', () => {
    localStorage.setItem('open-terminal:prefs', 'old');
    localStorage.setItem('parallax:prefs', 'new');
    migrateStorage(localStorage);
    expect(localStorage.getItem('parallax:prefs')).toBe('new');
    expect(localStorage.getItem('open-terminal:prefs')).toBeNull();
  });
});

describe('handoffEntries', () => {
  it('accepts only our own entries with string values', () => {
    const entries = { 'parallax:layout': '{}' };
    expect(handoffEntries({ type: 'parallax:handoff-entries', entries })).toEqual([
      ['parallax:layout', '{}'],
    ]);
    expect(
      handoffEntries({ type: 'parallax:handoff-entries', entries: { 'evil:key': 'x' } }),
    ).toBeNull();
    expect(
      handoffEntries({ type: 'parallax:handoff-entries', entries: { 'parallax:x': 1 } }),
    ).toBeNull();
    expect(handoffEntries({ type: 'other', entries })).toBeNull();
  });
});

/** A window that records listeners and posted messages. */
class FakeWindow {
  listeners = new Set<(event: MessageEvent) => void>();
  posted: { data: unknown; origin: string }[] = [];
  opener: FakeWindow | null = null;
  opened: FakeWindow | null = null;
  localStorage = window.localStorage;
  location: { href: string };
  constructor(href: string) {
    this.location = { href };
  }
  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }
  postMessage(data: unknown, origin: string) {
    this.posted.push({ data, origin });
  }
  setTimeout(handler: () => void, ms: number) {
    return setTimeout(handler, ms);
  }
  clearTimeout(id: number) {
    clearTimeout(id);
  }
  open(href: string) {
    this.opened = new FakeWindow(href);
    this.opened.opener = this;
    return this.opened;
  }
  deliver(data: unknown, origin: string, source: FakeWindow | null) {
    for (const listener of [...this.listeners]) {
      listener({ data, origin, source } as unknown as MessageEvent);
    }
  }
}

const asWindow = (fake: FakeWindow) => fake as unknown as Window;

describe('handoff between the old and new address', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(OLD_ORIGINS)('carries saved entries from %s to the new address', async (OLD_ORIGIN) => {
    expect(isOldAddress(OLD_ORIGIN)).toBe(true);
    const old = new FakeWindow(`${OLD_ORIGIN}/`);
    localStorage.setItem('parallax:layout', '{"dock":2}');
    expect(sendHandoff(asWindow(old))).toBe(true);
    const fresh = old.opened;
    if (!fresh) throw new Error('no window opened');
    expect(fresh.location.href).toBe(`${NEW_ORIGIN}/?handoff=1`);

    localStorage.clear();
    const moved = receiveHandoff(asWindow(fresh));
    // "Ready" goes to each old address at its exact origin; only the opener's own one arrives.
    expect(old.posted).toEqual(
      OLD_ORIGINS.map((origin) => ({ data: { type: 'parallax:handoff-ready' }, origin })),
    );

    // The old window answers the new one only, at its exact origin.
    old.deliver(old.posted[0]?.data, NEW_ORIGIN, fresh);
    expect(fresh.posted[0]?.origin).toBe(NEW_ORIGIN);
    // (In a browser the old window held its own storage; here both share jsdom's.)
    fresh.deliver(
      {
        type: 'parallax:handoff-entries',
        entries: { 'parallax:layout': '{"dock":2}' },
      },
      OLD_ORIGIN,
      old,
    );
    await expect(moved).resolves.toBe(true);
    expect(localStorage.getItem('parallax:layout')).toBe('{"dock":2}');
  });

  it('ignores messages from any other origin or window, then gives up', async () => {
    const opener = new FakeWindow(`${OPEN_TERMINAL_ORIGIN}/`);
    const fresh = new FakeWindow(`${NEW_ORIGIN}/?handoff=1`);
    fresh.opener = opener;
    const moved = receiveHandoff(asWindow(fresh));
    const entries = { type: 'parallax:handoff-entries', entries: { 'parallax:keys': 'stolen' } };
    fresh.deliver(entries, 'https://evil.example', opener);
    fresh.deliver(entries, OPEN_TERMINAL_ORIGIN, new FakeWindow('https://other/'));
    vi.advanceTimersByTime(HANDOFF_TIMEOUT_MS);
    await expect(moved).resolves.toBe(false);
    expect(localStorage.getItem('parallax:keys')).toBeNull();
  });

  it('does nothing on an ordinary visit', () => {
    expect(isOldAddress(NEW_ORIGIN)).toBe(false);
    expect(receiveHandoff(asWindow(new FakeWindow(`${NEW_ORIGIN}/`)))).toBeNull();
    expect(withoutHandoff(`${NEW_ORIGIN}/?handoff=1#w=abc`)).toBe(`${NEW_ORIGIN}/#w=abc`);
  });
});
