import { act, fireEvent, render, screen } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { badgeExplanation, GLOSSARY } from '../design/learn';
import type { Freshness } from '../design/format';
import type { HubRequest } from '../feeds/protocol';
import { connectFeed, disconnectFeed } from '../store/feedClient';
import { usePrefs } from '../store/prefs';
import { LearnLayer } from './LearnLayer';
import { LearnSwitch } from './LearnSwitch';
import { DOCK_COMPONENTS, WIDGETS } from './widgets';

const props = (id: string) =>
  ({
    api: { id: `${id}-1`, updateParameters: () => undefined },
    params: {},
  }) as unknown as IDockviewPanelProps;

beforeEach(() => {
  const ignore = (message: HubRequest) => message;
  connectFeed({ postMessage: ignore, onmessage: null });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  // As in the app (store/prefs.ts applyPrefs), learn mode marks <html>.
  const unsubscribe = usePrefs.subscribe(({ learn }) => {
    if (learn) document.documentElement.dataset.learn = 'on';
    else delete document.documentElement.dataset.learn;
  });
  return unsubscribe;
});

afterEach(() => {
  disconnectFeed();
  vi.unstubAllGlobals();
  usePrefs.setState({ learn: false });
});

describe('learn mode', () => {
  it('explains every panel', () => {
    for (const widget of WIDGETS)
      expect(widget.meta.learn.length, widget.meta.id).toBeGreaterThan(20);
  });

  it('explains every badge state in plain words', () => {
    const states: Freshness[] = [
      { kind: 'live', ageMs: 140, stale: false },
      { kind: 'live', ageMs: 140, stale: true },
      { kind: 'delayed', minutes: 15 },
      { kind: 'polled', everyMs: 15_000 },
      { kind: 'eod' },
      { kind: 'connecting' },
      { kind: 'rate-limited' },
      { kind: 'no-key' },
      { kind: 'key-rejected' },
      { kind: 'offline' },
    ];
    const texts = states.map((state) => badgeExplanation(state, 'coinbase'));
    expect(new Set(texts).size).toBe(states.length);
    expect(texts[0]).toBe(
      'Live from Coinbase: prices stream in as they happen. 140ms is how long the latest update took to reach you.',
    );
  });

  it('has a meaning for every column heading the boards show', () => {
    usePrefs.setState({ learn: true });
    for (const id of [
      'watchlist',
      'markets',
      'fx',
      'derivs',
      'tape',
      'book',
      'europe',
      'asia-pacific',
      'macro',
    ]) {
      const View = DOCK_COMPONENTS[id];
      if (!View) throw new Error(`no ${id} widget`);
      const { container, unmount } = render(<View {...props(id)} />);
      for (const heading of container.querySelectorAll('.market-columns > *')) {
        const text = heading.textContent.replace(/\s+/g, ' ').trim();
        if (text !== '') expect(GLOSSARY[text], `${id}: "${text}"`).toBeDefined();
      }
      unmount();
    }
  });

  it('shows a strip on each panel and explains a number by its column when switched on', () => {
    const Watchlist = DOCK_COMPONENTS.watchlist;
    if (!Watchlist) throw new Error('no watchlist');
    render(
      <>
        <LearnSwitch />
        <Watchlist {...props('watchlist')} />
        <LearnLayer />
      </>,
    );
    expect(screen.queryByRole('complementary', { name: 'Learn mode' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    expect(screen.getByRole('button', { name: 'Learn' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('complementary', { name: 'Learn mode' })).toHaveTextContent(
      'Your list of prices',
    );

    const change = document.querySelector('.market-row > :last-child');
    if (!change) throw new Error('no watchlist row');
    act(() => {
      fireEvent.pointerOver(change, { clientX: 10, clientY: 10 });
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent(GLOSSARY.Chg ?? '');

    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
