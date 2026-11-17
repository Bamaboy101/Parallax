import type { WidgetMeta } from '../types';

/** Shown until the user edits the list. */
export const DEFAULT_SYMBOLS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'XRP-USD',
  'PAXG-USD',
  'BTC-USDT',
  'EUR-USD',
  'GBP-USD',
  'USD-JPY',
];

export const meta: WidgetMeta = {
  id: 'watchlist',
  title: 'Watchlist',
  defaultSize: { width: 320, height: 420 },
  aliases: ['watchlist', 'watch', 'wl'],
  dock: true,
  input: 'symbols',
  defaultParams: { symbols: DEFAULT_SYMBOLS },
  learn:
    'Your list of prices. Each row shows the latest price, a small line of its recent trend and how much it has moved. Add more with “watch” in the command bar.',
};
