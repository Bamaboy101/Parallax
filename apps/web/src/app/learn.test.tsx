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

describe('learn mode explanation placement', () => {
  const TIP = { width: 280, height: 120 };
  type Rect = { left: number; top: number; right: number; bottom: number };
  const rect = ({ left, top, right, bottom }: Rect) =>
    ({
      left,
      top,
      right,
      bottom,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }) as DOMRect;

  /** Where the hovered term's element currently is; a test may move it. */
  let anchorAt: Rect = { left: 0, top: 0, right: 0, bottom: 0 };

  const boxNow = (): Rect => {
    const tip = screen.getByRole('tooltip');
    const left = Number.parseFloat(tip.style.left);
    const top = Number.parseFloat(tip.style.top);
    return { left, top, right: left + TIP.width, bottom: top + TIP.height };
  };

  /** Hover a term whose element sits at `anchor`; return where the box landed. */
  function boxFor(anchor: Rect): Rect {
    anchorAt = anchor;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this.classList.contains('learn-tip')
        ? rect({ left: 0, top: 0, right: TIP.width, bottom: TIP.height })
        : rect(anchorAt);
    });
    usePrefs.setState({ learn: true });
    render(
      <>
        <span data-term="Chg">+1.24%</span>
        <LearnLayer />
      </>,
    );
    act(() => {
      fireEvent.pointerOver(screen.getByText('+1.24%'));
    });
    return boxNow();
  }

  const overlaps = (a: Rect, b: Rect) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('moves with its number when layout shifts under a still pointer', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const before = boxFor({ left: 100, top: 300, right: 160, bottom: 316 });
    expect(before.top).toBe(324);
    // The row slides down to just above where the box was: without following, the box covers it.
    anchorAt = { left: 100, top: 330, right: 160, bottom: 346 };
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    const after = boxNow();
    expect(overlaps(after, anchorAt)).toBe(false);
    expect(after.top).toBe(354);
  });

  it.each([
    ['below when there is room', { left: 100, top: 300, right: 160, bottom: 316 }, 'below'],
    ['above near the bottom edge', { left: 900, top: 700, right: 960, bottom: 716 }, 'above'],
    [
      'beside an element too tall for either',
      { left: 100, top: 40, right: 160, bottom: 740 },
      'beside',
    ],
  ] as const)('goes %s, never over the number and inside the window', (_, anchor, side) => {
    const box = boxFor(anchor);
    expect(overlaps(box, anchor)).toBe(false);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    if (side === 'below') expect(box.top).toBeGreaterThanOrEqual(anchor.bottom);
    if (side === 'above') expect(box.bottom).toBeLessThanOrEqual(anchor.top);
    if (side === 'beside') expect(box.left).toBeGreaterThanOrEqual(anchor.right);
  });
});
