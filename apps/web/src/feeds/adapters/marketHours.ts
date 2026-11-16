const newYork = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60;

/**
 * Whether the US regular session (Mon–Fri 09:30–16:00 New York time) is open. Exchange holidays
 * are not modelled: on one, a quiet equity feed reads as stale, which is true enough.
 */
export function usMarketOpen(now: number): boolean {
  const parts = Object.fromEntries(
    newYork.formatToParts(now).map((part) => [part.type, part.value]),
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return minute >= OPEN_MINUTE && minute < CLOSE_MINUTE;
}
