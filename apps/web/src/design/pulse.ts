/**
 * "Pulse, not blink": a soft colour wash that fades over --motion-pulse (150 ms, 0 under reduced
 * motion). Uses the Web Animations API, so a ticking cell costs no React render and no layout.
 */
export function pulse(element: HTMLElement, direction: 'up' | 'down'): void {
  if (typeof element.animate !== 'function') return;
  const style = getComputedStyle(document.documentElement);
  const duration = Number.parseFloat(style.getPropertyValue('--motion-pulse'));
  if (!(duration > 0)) return;
  const color = style.getPropertyValue(direction === 'up' ? '--up' : '--down').trim();
  element.animate(
    [
      { backgroundColor: `color-mix(in oklab, ${color} 28%, transparent)` },
      { backgroundColor: 'transparent' },
    ],
    { duration, easing: 'ease-out' },
  );
}
