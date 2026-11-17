import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'copilot',
  title: 'Co-pilot',
  defaultSize: { width: 440, height: 520 },
  aliases: ['copilot', 'ask', 'explain'],
  dock: true,
  input: 'query',
  learn:
    'Ask in plain words, like “why is BTC down?” or “brief me on today”. It answers from the panels on your screen and recent headlines, names the ones it used, and explains; it never tells you to buy or sell. Uses your own AI key.',
};
