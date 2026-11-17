import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'calendar',
  title: 'Economic calendar',
  defaultSize: { width: 380, height: 520 },
  aliases: ['calendar', 'econ', 'releases', 'events'],
  dock: true,
  input: 'none',
  learn:
    'Upcoming US economic reports, such as jobs and inflation. Markets often move sharply in the minutes after one is published.',
};

/**
 * What each release covers, and the time the agency usually publishes it (New York time). FRED
 * gives dates only, so the time is the agency's habit, labelled as usual on the board.
 */
export const RELEASE_INFO: Readonly<Record<number, { about: string; usual: string }>> = {
  50: { about: 'Payrolls and the unemployment rate (BLS)', usual: '08:30' },
  10: { about: 'Consumer inflation (BLS)', usual: '08:30' },
  46: { about: 'Producer prices (BLS)', usual: '08:30' },
  53: { about: 'Economic growth (BEA)', usual: '08:30' },
  54: { about: 'PCE inflation, income and spending (BEA)', usual: '08:30' },
  9: { about: 'Consumer spending (Census)', usual: '08:30' },
  192: { about: 'Job openings and quits (BLS)', usual: '10:00' },
  13: { about: 'Factory output (Federal Reserve)', usual: '09:15' },
  27: { about: 'New homes started (Census)', usual: '08:30' },
  91: { about: 'Consumer mood (University of Michigan)', usual: '10:00' },
  180: { about: 'Weekly layoffs (Department of Labor)', usual: '08:30' },
};
