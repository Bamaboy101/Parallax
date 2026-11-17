import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'fx',
  title: 'FX',
  defaultSize: { width: 420, height: 600 },
  aliases: ['fx', 'forex', 'currencies', 'ecb'],
  dock: true,
  input: 'none',
  learn:
    'Currencies. The top half is live prices from an exchange; the bottom half is the European Central Bank’s official rate for about 30 currencies, set once each working day.',
};
