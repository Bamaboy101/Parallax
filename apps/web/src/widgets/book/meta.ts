import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'book',
  title: 'Order book',
  defaultSize: { width: 300, height: 420 },
  aliases: ['book', 'orderbook', 'depth', 'ob'],
  dock: true,
  input: 'symbol',
  learn:
    'The order book: everyone waiting to buy (bids, below) and to sell (asks, above). The gap between the best bid and ask is the spread; the shaded curve shows how much is waiting at each price.',
};

export const DEFAULT_SYMBOL = 'BTC-USD';
