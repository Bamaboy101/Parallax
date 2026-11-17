import { useEffect, useState } from 'react';
import { badgeExplanation, explainElement, type Explanation } from '../design/learn';
import type { Freshness } from '../design/format';
import { usePrefs } from '../store/prefs';

interface Shown extends Explanation {
  x: number;
  y: number;
}

const OFFSET = 14;
const WIDTH = 280;

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
 * explanation appears beside it. No animation; nothing renders while learn mode is off.
 */
export function LearnLayer() {
  const learn = usePrefs((prefs) => prefs.learn);
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    if (!learn) return;
    const place = (element: Element, x: number, y: number) => {
      const explanation = explain(element);
      setShown(explanation ? { ...explanation, x, y } : null);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Element) place(event.target, event.clientX, event.clientY);
    };
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const box = event.target.getBoundingClientRect();
      place(event.target, box.left, box.bottom);
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

  if (!learn || !shown) return null;
  const left = Math.max(8, Math.min(shown.x + OFFSET, window.innerWidth - WIDTH - 8));
  const top = Math.min(shown.y + OFFSET, window.innerHeight - 120);
  return (
    <div className="learn-tip" role="tooltip" style={{ left, top, width: WIDTH }}>
      <strong>{shown.term}</strong>
      <span>{shown.text}</span>
    </div>
  );
}
