import type { SerializedDockview } from 'dockview-react';
import { describe, expect, it } from 'vitest';
import { mirrorRoot, popoutsAsFloating } from './popout';

/** A stand-in popout window whose document can be swapped, as a loading page does. */
function fakeWindow() {
  const listeners = new Set<() => void>();
  const win = {
    document: document.implementation.createHTMLDocument('popout'),
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    load(next: Document) {
      win.document = next;
      for (const listener of listeners) listener();
    },
  };
  return win;
}

describe('mirrorRoot', () => {
  it('copies theme, density and learn mode to the window, follows changes, and survives the page loading', async () => {
    const source = document.implementation.createHTMLDocument('main');
    source.documentElement.dataset.theme = 'dark';
    source.documentElement.dataset.density = 'dense';
    const win = fakeWindow();
    const stop = mirrorRoot(win as unknown as Window, source);
    expect(win.document.documentElement.dataset.theme).toBe('dark');

    // popout.html replaces the blank document after the window is handed over.
    win.load(document.implementation.createHTMLDocument('loaded'));
    expect(win.document.documentElement.dataset.density).toBe('dense');

    source.documentElement.dataset.theme = 'light';
    source.documentElement.dataset.learn = 'on';
    delete source.documentElement.dataset.density;
    await Promise.resolve(); // MutationObserver callbacks run as microtasks
    expect(win.document.documentElement.dataset.theme).toBe('light');
    expect(win.document.documentElement.dataset.learn).toBe('on');
    expect(win.document.documentElement.dataset.density).toBeUndefined();

    stop();
    source.documentElement.dataset.theme = 'dark';
    await Promise.resolve();
    expect(win.document.documentElement.dataset.theme).toBe('light');
  });
});

describe('popoutsAsFloating', () => {
  const group = { id: 'g2', views: ['watchlist'], activeView: 'watchlist' };
  const base = {
    grid: {
      root: { type: 'branch', data: [] },
      height: 800,
      width: 1200,
      orientation: 'HORIZONTAL',
    },
    panels: {},
  } as unknown as SerializedDockview;

  it('brings popped-out groups back floating, sized to fit, without dropping anything', () => {
    const saved = {
      ...base,
      floatingGroups: [
        { data: { id: 'g1', views: [] }, position: { left: 0, top: 0, width: 400, height: 300 } },
      ],
      popoutGroups: [
        {
          data: group,
          url: '/popout.html',
          position: { left: 2000, top: 50, width: 1900, height: 100 },
        },
        { data: { ...group, id: 'g3' }, position: null },
      ],
    } as unknown as SerializedDockview;
    const restored = popoutsAsFloating(saved);
    expect(restored.popoutGroups).toEqual([]);
    expect(restored.floatingGroups).toHaveLength(3);
    expect(restored.floatingGroups?.[1]).toEqual({
      data: group,
      position: { left: 48, top: 48, width: 720, height: 240 },
    });
    expect(restored.floatingGroups?.[2]?.position).toEqual({
      left: 80,
      top: 80,
      width: 320,
      height: 240,
    });
  });

  it('leaves a layout without popouts alone', () => {
    expect(popoutsAsFloating(base)).toBe(base);
  });
});
