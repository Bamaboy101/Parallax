import { fireEvent, render, screen } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAlerts } from '../../store/alerts/store';
import Alerts from './index';

const props = (query?: string) =>
  ({ api: { id: 'alerts-1' }, params: query ? { query } : {} }) as unknown as IDockviewPanelProps<{
    query?: string;
  }>;

afterEach(() => {
  vi.unstubAllGlobals();
  useAlerts.setState({ alerts: [] });
});

describe('Alerts panel', () => {
  it('previews a command-bar alert in plain words, adds it and asks to notify', () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal(
      'Notification',
      Object.assign(vi.fn(), { permission: 'default', requestPermission }),
    );
    render(<Alerts {...props('BTC above 65k')} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Tell me when BTC/USD trades above 65,000.00.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(requestPermission).toHaveBeenCalledOnce();
    const list = screen.getByRole('list', { name: 'Your alerts' });
    expect(list).toHaveTextContent('BTC/USD trades above 65,000.00');
    expect(list).toHaveTextContent('Waiting for a price');
    expect(useAlerts.getState().alerts).toHaveLength(1);
  });

  it('will not add what it cannot read, and says why', () => {
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'granted' }));
    render(<Alerts {...props()} />);
    fireEvent.change(screen.getByLabelText('New alert'), { target: { value: 'BTC sideways' } });
    expect(screen.getByRole('status')).toHaveTextContent(/Say “above”, “below”/);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByText('Browser notifications are on.')).toBeInTheDocument();
  });
});
