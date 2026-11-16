import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'ticker-rail',
  title: 'Ticker rail',
  defaultSize: { width: 0, height: 32 },
  aliases: ['rail', 'ticker'],
  dock: false,
  input: 'none',
};

/** Headline instruments that need no key. */
export const RAIL_SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'PAXG-USD', 'EUR-USD', 'USD-JPY'];

/** US index proxies, shown first once a stock feed key is saved. */
export const EQUITY_RAIL_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'];

/** Feeds whose key switches on US stocks. */
export const EQUITY_KEY_PROVIDERS = ['alpaca', 'finnhub'];
