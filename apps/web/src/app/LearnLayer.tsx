import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { badgeExplanation, explainElement, type Explanation } from '../design/learn';
import type { Freshness } from '../design/format';
import { usePrefs } from '../store/prefs';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Shown extends Explanation {
  /** The explained element, which the box must never cover, wherever layout moves it. */
  anchor: Element;
}

/** Space between the box and what it explains, and between the box and the window edge. */
const GAP = 8;
const MARGIN = 8;
const WIDTH = 280;

/** The element an explanation is about: what `explain` matched, not the span under the pointer. */
const anchorOf = (element: Element): Element =>
  element.closest('.truth-badge, [data-term], .market-columns > *, .market-row > *') ??
  element.closest('dt, dd')?.closest('div') ??
  element;

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, Math.max(low, high)));

/**
 * Where the box goes: below the element, else above, else beside it (right, then left), always
 * inside the window. Only a box larger than every free side falls back to the roomier of below
 * and above.
 */
function place(anchor: Box, width: number, height: number): { left: number; top: number } {
  const viewWidth = window.innerWidth;
  const viewHeight = window.innerHeight;
  const alignedLeft = clamp(anchor.left, MARGIN, viewWidth - MARGIN - width);
  const below = anchor.bottom + GAP;
  if (below + height <= viewHeight - MARGIN) return { left: alignedLeft, top: below };
  const above = anchor.top - GAP - height;
  if (above >= MARGIN) return { left: alignedLeft, top: above };
  const besideTop = clamp(anchor.top, MARGIN, viewHeight - MARGIN - height);
  if (anchor.right + GAP + width <= viewWidth - MARGIN) {
    return { left: anchor.right + GAP, top: besideTop };
  }
  if (anchor.left - GAP - width >= MARGIN) {
    return { left: anchor.left - GAP - width, top: besideTop };
  }
  const roomBelow = viewHeight - anchor.bottom;
  const top = roomBelow >= anchor.top ? below : above;
  return { left: alignedLeft, top: clamp(top, MARGIN, viewHeight - MARGIN - height) };
}

/** A badge carries its state and label; its explanation needs only those and the source name. */
function badgeOf(element: Element): Explanation | null {
  const badge = element.closest('.truth-badge');
  if (!badge) return null;
  const label = badge.getAttribute('aria-label') ?? '';
  const [state, source = ''] = label.split(' · ');
  const kind = badge.getAttribute('data-state') as Freshness['kind'] | null;
  if (!kind || !state) return null;
  const age = /(\d+(?:\.\d+)?)(ms|s|m)\b/.exec(state);
  const ms = age ? Number(age[1]) * (age[2] === 'ms' ? 1 : age[2] === 's' ? 1000 : 60_000) : 0;
  const freshness: Freshness =
    kind === 'live'
      ? { kind, ageMs: ms, stale: badge.getAttribute('data-tone') === 'warn' }
      : kind === 'polled'
        ? { kind, everyMs: ms }
        : kind === 'delayed'
          ? { kind, minutes: Math.round(ms / 60_000) }
          : { kind };
  return { term: state, text: badgeExplanation(freshness, source) };
}

const explain = (element: Element): Explanation | null =>
  badgeOf(element) ?? explainElement(element);

/**
 * Learn mode (F5): hover or focus a number, column, label or badge and a plain-language
 * explanation appears next to it, never over it. No animation; nothing renders while learn mode
 * is off.
 */
export function LearnLayer() {
  const learn = usePrefs((prefs) => prefs.learn);
  const [shown, setShown] = useState<Shown | null>(null);
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!learn) return;
    const show = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const explanation = explain(target);
      if (!explanation) {
        setShown(null);
        return;
      }
      setShown({ ...explanation, anchor: anchorOf(target) });
    };
    const onPointer = (event: PointerEvent) => {
      show(event.target);
    };
    const onFocus = (event: FocusEvent) => {
      show(event.target);
    };
    const hide = () => {
      setShown(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('pointerover', onPointer);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerover', onPointer);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', onKey);
      // Turning learn mode off clears any explanation left on screen.
      hide();
    };
  }, [learn]);

  // The box's height depends on its text, so it is measured and placed before the browser paints,
  // then kept clear of its element every frame while shown: rows can move under a still pointer
  // (a strip above them rewraps, a panel resizes). One read, and a write only when it moved.
  useLayoutEffect(() => {
    const element = tip.current;
    if (!shown || !element) return;
    let frame = 0;
    let placed = '';
    const follow = () => {
      if (!shown.anchor.isConnected) {
        setShown(null);
        return;
      }
      const { width, height } = element.getBoundingClientRect();
      const { left, top } = place(shown.anchor.getBoundingClientRect(), width, height);
      const next = `${String(left)},${String(top)}`;
      if (next !== placed) {
        placed = next;
        element.style.left = `${String(left)}px`;
        element.style.top = `${String(top)}px`;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [shown]);

  if (!learn || !shown) return null;
  return (
    <div
      ref={tip}
      className="learn-tip"
      role="tooltip"
      style={{ left: 0, top: 0, width: Math.min(WIDTH, window.innerWidth - 2 * MARGIN) }}
    >
      <strong>{shown.term}</strong>
      <span>{shown.text}</span>
    </div>
  );
}
