/**
 * Regular trading sessions in each exchange's own time zone, so daylight saving follows the
 * exchange. Exchange holidays are not modelled.
 */
export interface Market {
  id: string;
  name: string;
  /** IANA zone; absent for markets that never close. */
  timeZone?: string;
  /** [open, close) in local minutes after midnight, Monday to Friday. */
  sessions: readonly (readonly [number, number])[];
}

const at = (hours: number, minutes = 0) => hours * 60 + minutes;

export const MARKETS: readonly Market[] = [
  // Tokyo Stock Exchange: morning and afternoon sessions, close at 15:30 since November 2024.
  {
    id: 'tokyo',
    name: 'Tokyo',
    timeZone: 'Asia/Tokyo',
    sessions: [
      [at(9), at(11, 30)],
      [at(12, 30), at(15, 30)],
    ],
  },
  { id: 'london', name: 'London', timeZone: 'Europe/London', sessions: [[at(8), at(16, 30)]] },
  {
    id: 'new-york',
    name: 'New York',
    timeZone: 'America/New_York',
    sessions: [[at(9, 30), at(16)]],
  },
  { id: 'crypto', name: 'Crypto', sessions: [] },
];

const DAY = 24 * 60;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Weekday (0 = Sunday) and minute of the day at `now` in a time zone. */
export function localTime(now: number, timeZone: string): { weekday: number; minute: number } {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? '');
  return { weekday, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

export interface SessionState {
  open: boolean;
  /** Minutes until the next open or close; undefined for markets that never close. */
  minutesToChange: number | undefined;
}

/** Whether a market is open at `now`, and how long until that changes. */
export function sessionState(market: Market, now: number): SessionState {
  if (!market.timeZone) return { open: true, minutesToChange: undefined };
  const { weekday, minute } = localTime(now, market.timeZone);
  const weekdayOpen = weekday >= 1 && weekday <= 5;
  if (weekdayOpen) {
    const current = market.sessions.find(([open, close]) => minute >= open && minute < close);
    if (current) return { open: true, minutesToChange: current[1] - minute };
    const later = market.sessions.find(([open]) => open > minute);
    if (later) return { open: false, minutesToChange: later[0] - minute };
  }
  // Closed for the rest of today: the first session of the next weekday.
  const first = market.sessions[0]?.[0] ?? 0;
  let days = 1;
  while (((weekday + days) % 7 === 0 || (weekday + days) % 7 === 6) && days < 7) days += 1;
  return { open: false, minutesToChange: days * DAY - minute + first };
}

/** Minutes the zone is ahead of UTC at `now`. */
export function utcOffset(now: number, timeZone: string): number {
  const { minute } = localTime(now, timeZone);
  const utcMinute = new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes();
  let offset = minute - utcMinute;
  if (offset > 12 * 60) offset -= DAY;
  if (offset < -12 * 60) offset += DAY;
  return offset;
}

/** A market's sessions as [start, end) minutes on the viewer's 24-hour clock. */
export function sessionsOnClock(
  market: Market,
  now: number,
  viewerOffset: number,
): (readonly [number, number])[] {
  if (!market.timeZone) return [[0, DAY]];
  const shift = viewerOffset - utcOffset(now, market.timeZone);
  return market.sessions.map(([open, close]) => {
    const start = (((open + shift) % DAY) + DAY) % DAY;
    return [start, start + (close - open)] as const;
  });
}
