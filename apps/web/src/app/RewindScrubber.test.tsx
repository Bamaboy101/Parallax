import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTicks, useTickStore } from '../store/ticks';
import { RewindScrubber } from './RewindScrubber';

beforeEach(() => {
  vi.useFakeTimers({ now: Date.now() });
});

afterEach(() => {
  vi.useRealTimers();
  resetTicks();
});

describe('RewindScrubber', () => {
  it('moves the whole terminal back in time, and returns to live', () => {
    // The page has been open for 20 minutes.
    act(() => {
      vi.advanceTimersByTime(20 * 60_000);
    });
    render(<RewindScrubber />);
    const slider = screen.getByRole('slider', { name: 'Rewind the terminal' });
    expect(screen.getByText('Live')).toBeInTheDocument();

    const target = Date.now() - 12 * 60_000;
    fireEvent.change(slider, { target: { value: String(target) } });
    expect(useTickStore.getState().cursor).toBe(target);
    expect(screen.getByText(/^−12:00 · /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }));
    expect(useTickStore.getState().cursor).toBeNull();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('treats the right end of the track as live', () => {
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    render(<RewindScrubber />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: String(Date.now()) } });
    expect(useTickStore.getState().cursor).toBeNull();
  });
});
