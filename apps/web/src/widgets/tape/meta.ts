import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'tape',
  title: 'Trades',
  defaultSize: { width: 300, height: 420 },
  aliases: ['tape', 'trades', 'prints', 'ts'],
  dock: true,
};

export const DEFAULT_SYMBOL = 'BTC-USD';
