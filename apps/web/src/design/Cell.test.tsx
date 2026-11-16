import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cell } from './Cell';

// Like the real API, animate() returns an Animation; this one has already finished.
const animate = vi.fn<HTMLElement['animate']>(
  () => ({ playState: 'finished', cancel: vi.fn() }) as unknown as Animation,
);

beforeEach(() => {
  HTMLElement.prototype.animate = animate;
  document.documentElement.style.setProperty('--motion-pulse', '150ms');
  document.documentElement.style.setProperty('--up', '#00ff00');
  document.documentElement.style.setProperty('--down', '#ff0000');
});

afterEach(() => {
  animate.mockReset();
  document.documentElement.removeAttribute('style');
});

describe('Cell pulse', () => {
  it('washes up or down when the value changes, not on first render', () => {
    const view = render(<Cell value={100} pulse />);
    expect(animate).not.toHaveBeenCalled();

    view.rerender(<Cell value={101} pulse />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(animate.mock.calls[0])).toContain('#00ff00');
    expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 150 });

    view.rerender(<Cell value={99} pulse />);
    expect(JSON.stringify(animate.mock.calls[1])).toContain('#ff0000');
  });

  it('stays still when the system asks for reduced motion', () => {
    document.documentElement.style.setProperty('--motion-pulse', '0ms');
    const view = render(<Cell value={100} pulse />);
    view.rerender(<Cell value={101} pulse />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('does not pulse unless asked', () => {
    const view = render(<Cell value={100} />);
    view.rerender(<Cell value={101} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
