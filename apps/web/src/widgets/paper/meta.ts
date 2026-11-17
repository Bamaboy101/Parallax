import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'paper',
  title: 'Paper trading',
  defaultSize: { width: 460, height: 460 },
  aliases: ['paper', 'trading', 'orders', 'positions', 'portfolio'],
  dock: true,
  input: 'none',
  learn:
    'Practice trading with fake money on your free Alpaca paper account: what you own, what it is worth, your profit or loss, and orders still waiting. No real money moves.',
};
