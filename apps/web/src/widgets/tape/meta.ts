import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'tape',
  title: 'Trades',
  defaultSize: { width: 300, height: 420 },
  aliases: ['tape', 'trades', 'prints', 'ts'],
  dock: true,
  pro: true,
  input: 'symbol',
  learn:
    'Time and sales: every trade as it happens, newest at the top, with its price and size. Green traded higher than the one before, red lower.',
};

export const DEFAULT_SYMBOL = 'BTC-USD';
