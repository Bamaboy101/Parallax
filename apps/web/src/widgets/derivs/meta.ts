import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'derivs',
  title: 'Crypto derivatives',
  defaultSize: { width: 480, height: 560 },
  aliases: ['derivatives', 'derivs', 'perps', 'funding', 'liquidations', 'oi'],
  dock: true,
  input: 'none',
  learn:
    'Crypto perpetual futures: contracts that track a coin without expiring. Funding shows which side is paying to hold its bet, open interest how much money is in play, and liquidations when traders were forced out of losing bets.',
};
