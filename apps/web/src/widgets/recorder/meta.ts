import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'recorder',
  title: 'Session recorder',
  defaultSize: { width: 380, height: 360 },
  aliases: ['recorder', 'record', 'replay', 'recording'],
  dock: true,
  input: 'none',
  learn:
    'Records what the markets did while you watched (prices, trades, order books, funding), saves it as a file and plays it back later through Rewind, with every panel following. Market data only: no keys or settings go into the file.',
};
