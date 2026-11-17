import type { WidgetMeta } from '../types';

/** Crypto majors and FX: they stream without a key, around the clock. */
export const DEFAULT_SYMBOLS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'XRP-USD',
  'DOGE-USD',
  'ADA-USD',
  'AVAX-USD',
  'LINK-USD',
  'PAXG-USD',
  'EUR-USD',
  'GBP-USD',
  'USD-JPY',
  'AUD-USD',
];

/** Added once a stock feed key is saved. */
export const EQUITY_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA'];

export const meta: WidgetMeta = {
  id: 'constellation',
  title: 'Constellation',
  defaultSize: { width: 520, height: 420 },
  aliases: ['constellation', 'sky', 'map'],
  dock: true,
  input: 'symbols',
  learn:
    'A map of how markets move together. Bodies that move in step drift close; lines join strong pairs (dashed when they move in opposite directions). Bigger bodies traded more; colour shows the move. Positions are relationships, not prices.',
};
