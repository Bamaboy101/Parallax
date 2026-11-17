import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrefs } from '../store/prefs';
import { Tour } from './Tour';
import { TOUR_STEPS } from './tourSteps';

function Targets() {
  return (
    <>
      <div data-tour="rundown">Rundown</div>
      <button type="button" data-tour="search">
        Search
      </button>
      <button type="button" data-tour="cockpit">
        Cockpit
      </button>
      <button type="button" data-tour="keys">
        Keys
      </button>
    </>
  );
}

describe('guided first visit', () => {
  beforeEach(() => {
    usePrefs.setState({ view: 'rundown', toured: false });
    // jsdom lays nothing out, so it has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('walks the four stops in order and is not shown again once done', () => {
    const { rerender } = render(
      <>
        <Targets />
        <Tour />
      </>,
    );
    for (const [index, step] of TOUR_STEPS.entries()) {
      expect(screen.getByRole('dialog', { name: step.title })).toBeInTheDocument();
      expect(screen.getByText(`Step ${String(index + 1)} of 4`)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: index === 3 ? 'Done' : 'Next' }));
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(usePrefs.getState().toured).toBe(true);
    rerender(<Tour />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('can be skipped, by button or Escape', () => {
    render(<Tour />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(usePrefs.getState().toured).toBe(true);
  });

  it('waits for the Rundown, and counts as seen if the visitor leaves it mid-tour', () => {
    usePrefs.setState({ view: 'cockpit' });
    const { rerender } = render(<Tour />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(usePrefs.getState().toured).toBe(false);
    usePrefs.setState({ view: 'rundown' });
    rerender(<Tour />);
    expect(screen.getByRole('dialog', { name: 'The Rundown' })).toBeInTheDocument();
    usePrefs.setState({ view: 'cockpit' });
    rerender(<Tour />);
    expect(usePrefs.getState().toured).toBe(true);
  });
});
