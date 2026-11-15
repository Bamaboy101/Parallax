import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'watchlist',
  title: 'Watchlist',
  defaultSize: { width: 320, height: 420 },
  aliases: ['watchlist', 'watch', 'wl'],
  dock: true,
};

/** Shown until the user edits the list (T11). */
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
