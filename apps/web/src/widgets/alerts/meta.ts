import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'alerts',
  title: 'Alerts',
  defaultSize: { width: 420, height: 440 },
  aliases: ['alert', 'alerts', 'notify'],
  dock: true,
  input: 'query',
  learn:
    'Alerts in plain words, like “BTC above 65000” or “ETH down 2% in 15m”. The terminal watches the live prices and tells you with a browser notification when one happens. They work while Open Terminal is open in a tab.',
};
