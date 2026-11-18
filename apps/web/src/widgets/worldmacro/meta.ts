import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'worldmacro',
  title: 'Global macro',
  defaultSize: { width: 680, height: 620 },
  aliases: ['global', 'gdp', 'inflation', 'debt', 'imf', 'worldbank'],
  dock: true,
  input: 'none',
  learn:
    'How the world’s economies are doing: how fast each is growing, how fast its prices are rising and how much its government owes, shaded on a map, with the 50 largest economies listed below. Yearly figures: the IMF’s estimates for this year and the World Bank’s latest size of each economy.',
};
