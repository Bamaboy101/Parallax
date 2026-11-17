import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'rates',
  title: 'Rates desk',
  defaultSize: { width: 560, height: 640 },
  aliases: ['rates', 'curve', 'yields', 'treasury', 'sofr'],
  dock: true,
  input: 'none',
  learn:
    'Interest rates. The yield curve shows what the US government pays to borrow for one month up to 30 years; SOFR and the fed funds rate are what banks pay overnight; the Fed sets a target range for the latter. Official end-of-day figures from the US Treasury and the New York Fed.',
};
