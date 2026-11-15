import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'book',
  title: 'Order book',
  defaultSize: { width: 300, height: 420 },
  aliases: ['book', 'orderbook', 'depth', 'ob'],
  dock: true,
  input: 'symbol',
};

export const DEFAULT_SYMBOL = 'BTC-USD';
