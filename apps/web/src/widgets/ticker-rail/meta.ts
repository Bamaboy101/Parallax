import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'ticker-rail',
  title: 'Ticker rail',
  defaultSize: { width: 0, height: 32 },
  aliases: ['rail', 'ticker'],
  dock: false,
};

/** Headline instruments. ETF index proxies (SPY, QQQ, DIA, IWM) join with the equity feeds. */
export const RAIL_SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'PAXG-USD', 'EUR-USD', 'USD-JPY'];
