import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'predictions',
  title: 'Event odds',
  defaultSize: { width: 460, height: 520 },
  aliases: ['odds', 'predictions', 'polymarket', 'events'],
  dock: true,
  input: 'query',
  learn:
    'Prediction markets: people bet on events such as a Fed rate decision. The odds are what they pay for each outcome, a market price, not a forecast. Each event sits beside the assets it can move.',
};
