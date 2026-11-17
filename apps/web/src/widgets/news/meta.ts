import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'news',
  title: 'News',
  defaultSize: { width: 380, height: 420 },
  aliases: ['news', 'headlines'],
  dock: true,
  input: 'query',
  learn:
    'Recent headlines from public news feeds, newest first. Click one to read it at the publisher.',
};
