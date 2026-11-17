import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'options',
  title: 'Options',
  defaultSize: { width: 620, height: 560 },
  aliases: ['options', 'chain', 'opt'],
  dock: true,
  pro: true,
  input: 'symbol',
  defaultParams: { symbol: 'SPY' },
  learn:
    'Options on a US stock or ETF: contracts to buy (calls) or sell (puts) at a set price, the strike, by a set date, the expiry. Calls sit left and puts right of each strike; the curve above shows how much movement traders are pricing in at each strike. Free indicative data from Alpaca: quotes adjusted, trades 15 minutes late.',
};
