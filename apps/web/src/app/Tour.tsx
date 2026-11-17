import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import '../design/tour.css';
import { usePrefs } from '../store/prefs';
import { TOUR_STEPS } from './tourSteps';

/** Narrower than this, the card sits at the bottom of the screen instead of beside its target. */
const DOCKED_BELOW = 760;
const GAP = 12;
const CARD_WIDTH = 320;

interface Placement {
  ring: { top: number; left: number; width: number; height: number } | null;
  /** Beside the target on wide screens; null leaves the card docked at the bottom (CSS). */
  card: { top: number; left: number; right: 'auto'; bottom: 'auto' } | null;
}

function place(target: Element | null, card: HTMLElement | null): Placement {
  if (!target) return { ring: null, card: null };
  const rect = target.getBoundingClientRect();
  const ring = {
    top: rect.top - 4,
    left: rect.left - 4,
    width: rect.width + 8,
    height: rect.height + 8,
  };
  if (window.innerWidth < DOCKED_BELOW || !card) return { ring, card: null };
  const height = card.offsetHeight;
  const below = rect.bottom + GAP;
  const top =
    below + height <= window.innerHeight - GAP ? below : Math.max(GAP, rect.top - GAP - height);
  const left = Math.min(Math.max(GAP, rect.left), window.innerWidth - CARD_WIDTH - GAP);
  return { ring, card: { top, left, right: 'auto', bottom: 'auto' } };
}

/**
 * E3 Guided first visit: shown once, on the Rundown, to someone who has not seen it. Skip, Back,
 * Next and Done; Escape skips. Leaving the Rundown ends it. Nothing animates.
 */
export function Tour() {
  const toured = usePrefs((state) => state.toured);
  const view = usePrefs((state) => state.view);
  const setToured = usePrefs((state) => state.setToured);
  const [step, setStep] = useState(0);
  const [placement, setPlacement] = useState<Placement>({ ring: null, card: null });
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();
  const active = !toured && view === 'rundown';
  const current = TOUR_STEPS[step];

  const finish = useCallback(() => {
    setToured(true);
  }, [setToured]);

  // Leaving the Rundown (the cockpit button, a command) ends the tour once it has been seen.
  const seen = useRef(false);
  useEffect(() => {
    if (active) seen.current = true;
  }, [active]);
  useEffect(() => {
    if (!toured && view !== 'rundown' && seen.current) finish();
  }, [toured, view, finish]);
  useLayoutEffect(() => {
    if (!active || !current) return;
    const target = document.querySelector(`[data-tour="${current.target}"]`);
    target?.scrollIntoView({ block: 'nearest' });
    const measure = () => {
      setPlacement(place(target, card.current));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, current]);

  useEffect(() => {
    if (active) primary.current?.focus();
  }, [active, step]);

  if (!active || !current) return null;
  const last = step === TOUR_STEPS.length - 1;
  return (
    <>
      {placement.ring && <div className="tour-ring" aria-hidden="true" style={placement.ring} />}
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={textId}
        style={placement.card ?? undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') finish();
        }}
      >
        <p className="tour-step">
          Step {step + 1} of {TOUR_STEPS.length}
        </p>
        <h2 id={titleId}>{current.title}</h2>
        <p id={textId}>{current.text}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={finish}>
            Skip tour
          </button>
          {step > 0 && (
            <button
              type="button"
              onClick={() => {
                setStep(step - 1);
              }}
            >
              Back
            </button>
          )}
          <button
            ref={primary}
            type="button"
            className="tour-next"
            onClick={() => {
              if (last) finish();
              else setStep(step + 1);
            }}
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}
