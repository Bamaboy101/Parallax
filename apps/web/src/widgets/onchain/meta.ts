import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'onchain',
  title: 'On-chain',
  defaultSize: { width: 440, height: 620 },
  aliases: ['onchain', 'on-chain', 'mempool', 'gas', 'fear', 'greed'],
  dock: true,
  pro: true,
  input: 'none',
  learn:
    'What the blockchains themselves show: what it costs to get a Bitcoin or Ethereum transaction in the next blocks, how many are waiting, the latest Bitcoin blocks, how many dollar stablecoins exist on Ethereum, and a daily mood index for crypto.',
};
