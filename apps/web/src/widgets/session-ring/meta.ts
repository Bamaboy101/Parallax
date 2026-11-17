import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'session-ring',
  title: 'Sessions',
  defaultSize: { width: 320, height: 360 },
  aliases: ['ring', 'sessions', 'session', 'hours'],
  dock: true,
  input: 'none',
  learn:
    'A 24-hour clock of when the world’s stock exchanges are open, on your local time. Lit arcs are open now; the hand shows the current time.',
};
