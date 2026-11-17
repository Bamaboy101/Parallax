import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'chart',
  title: 'Chart',
  defaultSize: { width: 640, height: 420 },
  aliases: ['chart', 'candles'],
  dock: true,
  input: 'symbol',
  learn:
    'A candlestick chart. Each candle is one period: its body runs from the opening to the closing price (green if it closed higher, red if lower) and its thin wicks show the highest and lowest prices. Bars underneath are how much traded.',
};

export const DEFAULT_SYMBOL = 'BTC-USD';
export const DEFAULT_INTERVAL = '15m';
