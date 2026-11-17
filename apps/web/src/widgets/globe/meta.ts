import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'globe',
  title: 'World',
  defaultSize: { width: 520, height: 560 },
  aliases: ['globe', 'world', 'earth'],
  dock: true,
  input: 'none',
  learn:
    'The world right now: the shaded side is night, mint dots are stock exchanges open now, and the coloured arcs run from New York to the three markets that moved most today, measured by the US-listed fund that tracks each one. Drag to turn the globe.',
};
