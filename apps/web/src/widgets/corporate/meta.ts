import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'corporate',
  title: 'Corporate events',
  defaultSize: { width: 460, height: 520 },
  aliases: ['corporate', 'earnings', 'insiders', 'insider', 'holders', 'form4'],
  dock: true,
  input: 'symbol',
  learn:
    'When companies report their results, and what the people who run them and their biggest shareholders have been doing with the shares. Earnings dates come from Finnhub on your own key; insider trades (Form 4) and large holders (Schedules 13D and 13G) are public SEC filings.',
};
