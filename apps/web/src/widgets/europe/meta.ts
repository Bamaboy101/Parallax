import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'europe',
  title: 'Europe',
  defaultSize: { width: 420, height: 560 },
  aliases: ['europe', 'eu', 'dax', 'ftse', 'stoxx'],
  dock: true,
  input: 'none',
  learn:
    'European stock markets. The currencies at the top move live in European hours; the index rows use US-listed funds (proxies) that only trade in New York hours.',
};
