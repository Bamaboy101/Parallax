import { useEffect, useState } from 'react';
import { isObject } from '../feeds/adapters/parse';
import { edgeJson } from './edge';
import { reportRestFreshness } from './panels';

/** The edge caches the calendar for 6 hours; looking hourly picks up a new day promptly. */
export const CALENDAR_REFRESH_MS = 60 * 60_000;

/** One scheduled release from FRED's calendar: a date, no time. */
export interface Release {
  /** YYYY-MM-DD, a US calendar date. */
  date: string;
  /** FRED release id. */
  id: number;
  name: string;
}

/** The edge's `/calendar` answer → releases, soonest first; null when it is not one. */
export function parseCalendar(body: unknown): Release[] | null {
  if (!isObject(body) || !Array.isArray(body.releases)) return null;
  return body.releases
    .flatMap((entry): Release[] =>
      isObject(entry) &&
      typeof entry.date === 'string' &&
      typeof entry.id === 'number' &&
      typeof entry.name === 'string'
        ? [{ date: entry.date, id: entry.id, name: entry.name }]
        : [],
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

const newYorkClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The instant a New York wall-clock time ('08:30') falls on a date, in EST or EDT as it was. */
export function newYorkInstant(date: string, time: string): number {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  for (const offset of [5, 4]) {
    const instant = Date.UTC(year, month - 1, day, hour + offset, minute);
    if (newYorkClock.format(instant) === time) return instant;
  }
  return Date.UTC(year, month - 1, day, hour + 5, minute);
}

export interface CalendarState {
  state: 'loading' | 'ready' | 'error';
  releases: Release[];
  error: string | undefined;
}

/** Upcoming major US releases, from FRED's calendar through the edge. */
export function useCalendar(): CalendarState {
  const [calendar, setCalendar] = useState<CalendarState>({
    state: 'loading',
    releases: [],
    error: undefined,
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const releases = parseCalendar(await edgeJson('/calendar'));
        if (!releases) throw new Error('unreadable calendar');
        if (cancelled) return;
        reportRestFreshness('fred', { kind: 'eod' });
        setCalendar({ state: 'ready', releases, error: undefined });
      } catch (error) {
        if (cancelled) return;
        reportRestFreshness('fred', { kind: 'offline' });
        setCalendar((current) => ({
          state: current.releases.length > 0 ? 'ready' : 'error',
          releases: current.releases,
          error: error instanceof Error ? error.message : 'calendar unavailable',
        }));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), CALENDAR_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return calendar;
}
