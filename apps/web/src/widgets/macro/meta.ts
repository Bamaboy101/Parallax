import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'macro',
  title: 'Macro',
  defaultSize: { width: 380, height: 420 },
  aliases: ['macro', 'fred', 'economy'],
  dock: true,
  input: 'none',
  learn:
    'The US economy at a glance: the yield curve (what the government pays to borrow for different lengths of time) and key statistics such as inflation and unemployment. Official data, published daily or monthly.',
};
