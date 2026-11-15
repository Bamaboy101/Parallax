import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WidgetMeta } from '../widgets/types';
import { CommandPalette } from './CommandPalette';
import type { Command } from './parser';

const chart: WidgetMeta = {
  id: 'chart',
  title: 'Chart',
  defaultSize: { width: 1, height: 1 },
  aliases: ['chart'],
  dock: true,
  input: 'symbol',
};

function setup() {
  const run = vi.fn<(command: Command) => boolean>(() => true);
  render(<CommandPalette run={run} widgets={[chart]} layouts={['default']} />);
  return run;
}

describe('CommandPalette', () => {
  it('opens on "/" and runs the highlighted suggestion with Enter', () => {
    const run = setup();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(window, { key: '/' });
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: 'eth chart 4h' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Chart ETH/USD 4h');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'open',
      interval: '4h',
      symbol: { id: 'ETH-USD' },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves the selection with the arrow keys', () => {
    const run = setup();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'btc' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run.mock.calls[0]?.[0]).toMatchObject({ kind: 'load', symbol: { id: 'BTC-USDT' } });
  });

  it('ignores "/" typed into a text field, and closes on Escape', () => {
    setup();
    const field = document.createElement('input');
    document.body.append(field);
    fireEvent.keyDown(field, { key: '/' });
    expect(screen.queryByRole('dialog')).toBeNull();
    field.remove();

    fireEvent.keyDown(window, { key: '/' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
