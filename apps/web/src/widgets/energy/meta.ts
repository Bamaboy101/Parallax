import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'energy',
  title: 'Energy',
  defaultSize: { width: 420, height: 460 },
  aliases: ['energy', 'eia', 'inventories', 'crude', 'natgas'],
  dock: true,
  input: 'none',
  learn:
    'How much oil, fuel and natural gas the US has in storage, how much it pumps and how busy its refineries are, from the government’s weekly reports. A bigger build than usual for the time of year can weigh on prices; a bigger draw can lift them.',
};
