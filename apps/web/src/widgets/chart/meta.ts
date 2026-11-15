import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'chart',
  title: 'Chart',
  defaultSize: { width: 640, height: 420 },
  aliases: ['chart', 'candles', 'c'],
  dock: true,
};

export const DEFAULT_SYMBOL = 'BTC-USD';
export const DEFAULT_INTERVAL = '15m';
