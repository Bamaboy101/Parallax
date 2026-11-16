import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'predictions',
  title: 'Event odds',
  defaultSize: { width: 460, height: 520 },
  aliases: ['odds', 'predictions', 'polymarket', 'events'],
  dock: true,
  input: 'query',
};
