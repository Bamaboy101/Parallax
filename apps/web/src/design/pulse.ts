interface PulseTokens {
  duration: number;
  up: string;
  down: string;
}

let tokens: PulseTokens | null = null;

/**
 * The pulse's duration and colours, read once and again only when the theme, palette or motion
 * preference changes: reading computed style per tick forces a style recalculation on every
 * price change, which a busy board cannot afford.
 */
function pulseTokens(): PulseTokens {
  if (tokens) return tokens;
  const style = getComputedStyle(document.documentElement);
  tokens = {
    duration: Number.parseFloat(style.getPropertyValue('--motion-pulse')),
    up: style.getPropertyValue('--up').trim(),
    down: style.getPropertyValue('--down').trim(),
  };
  return tokens;
}

if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const forget = () => {
    tokens = null;
  };
  new MutationObserver(forget).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-palette', 'data-density', 'style'],
  });
  if (typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', forget);
  }
}

/** The wash running on each cell, so a cell ticking faster than the fade never stacks them. */
const running = new WeakMap<HTMLElement, { animation: Animation; direction: 'up' | 'down' }>();

/**
 * "Pulse, not blink": a soft colour wash that fades over --motion-pulse (150 ms, 0 under reduced
 * motion). Uses the Web Animations API, so a ticking cell costs no React render and no layout.
 * A change in the same direction while a wash is still fading lets it finish; a reversal
 * replaces it, so the colour always shows the latest move.
 */
export function pulse(element: HTMLElement, direction: 'up' | 'down'): void {
  if (typeof element.animate !== 'function') return;
  const { duration, up, down } = pulseTokens();
  if (!(duration > 0)) return;
  const current = running.get(element);
  if (current && current.animation.playState === 'running') {
    if (current.direction === direction) return;
    current.animation.cancel();
  }
  const animation = element.animate(
    [
      {
        backgroundColor: `color-mix(in oklab, ${direction === 'up' ? up : down} 28%, transparent)`,
      },
      { backgroundColor: 'transparent' },
    ],
    { duration, easing: 'ease-out' },
  );
  running.set(element, { animation, direction });
}
