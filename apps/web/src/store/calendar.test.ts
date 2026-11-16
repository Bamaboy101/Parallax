import { describe, expect, it } from 'vitest';
import { newYorkInstant, parseCalendar } from './calendar';

describe('parseCalendar', () => {
  it('keeps well-formed releases, soonest first, and rejects junk', () => {
    expect(
      parseCalendar({
        from: '2026-11-16',
        to: '2026-12-16',
        releases: [
          { date: '2026-12-10', id: 10, name: 'Consumer Price Index' },
          { date: '2026-11-19', id: 180, name: 'Jobless Claims' },
          { date: 20261119, id: 1, name: 'bad' },
        ],
      }),
    ).toEqual([
      { date: '2026-11-19', id: 180, name: 'Jobless Claims' },
      { date: '2026-12-10', id: 10, name: 'Consumer Price Index' },
    ]);
    expect(parseCalendar({ error: 'FRED key not configured' })).toBeNull();
  });
});

describe('newYorkInstant', () => {
  it('places 08:30 New York time in winter (EST) and summer (EDT)', () => {
    expect(new Date(newYorkInstant('2026-12-10', '08:30')).toISOString()).toBe(
      '2026-12-10T13:30:00.000Z',
    );
    expect(new Date(newYorkInstant('2026-07-02', '08:30')).toISOString()).toBe(
      '2026-07-02T12:30:00.000Z',
    );
  });
});
