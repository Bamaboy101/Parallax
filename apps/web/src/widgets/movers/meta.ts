import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'movers',
  title: 'Movers',
  defaultSize: { width: 380, height: 560 },
  aliases: ['movers', 'gainers', 'losers', 'breadth', 'active'],
  dock: true,
  input: 'none',
  learn:
    'What is moving most among everything the terminal shows: the biggest gainers, losers and most traded, and breadth (how many are up against down).',
};
