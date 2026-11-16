import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelBoundary } from './PanelBoundary';

let broken = true;
function Flaky() {
  if (broken) throw new Error('Cannot update oldest data');
  return <p>Chart is back</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PanelBoundary', () => {
  it('keeps a failing widget inside its panel and lets the user retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <>
        <PanelBoundary title="Chart">
          <Flaky />
        </PanelBoundary>
        <p>Watchlist still here</p>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Chart stopped working.');
    expect(screen.getByText('Watchlist still here')).toBeInTheDocument();

    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Chart is back')).toBeInTheDocument();
  });
});
