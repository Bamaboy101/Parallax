import { describe, expect, it } from 'vitest';
import { MARKETS, sessionState, sessionsOnClock, utcOffset, type Market } from './markets';

function market(id: string): Market {
  const found = MARKETS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(id);
  return found;
}

const tokyo = market('tokyo');
const london = market('london');
const newYork = market('new-york');
const crypto = market('crypto');

describe('sessionState', () => {
  it('reads each exchange in its own time zone, daylight saving included', () => {
    // Monday 16 Nov 2026, 14:45 UTC: 09:45 in New York (EST), 14:45 in London (GMT), 23:45 in Tokyo.
    const now = Date.parse('2026-11-16T14:45:00Z');
    expect(sessionState(newYork, now)).toEqual({ open: true, minutesToChange: 375 });
    expect(sessionState(london, now)).toEqual({ open: true, minutesToChange: 105 });
    expect(sessionState(tokyo, now).open).toBe(false);
    expect(sessionState(crypto, now)).toEqual({ open: true, minutesToChange: undefined });

    // 1 July 2026, 13:15 UTC: New York is on EDT, so 09:15 local: 15 minutes before the bell.
    expect(sessionState(newYork, Date.parse('2026-07-01T13:15:00Z'))).toEqual({
      open: false,
      minutesToChange: 15,
    });
  });

  it('closes Tokyo for lunch', () => {
    // 03:00 UTC is 12:00 in Tokyo: the afternoon session opens at 12:30.
    expect(sessionState(tokyo, Date.parse('2026-11-17T03:00:00Z'))).toEqual({
      open: false,
      minutesToChange: 30,
    });
  });

  it('counts over the weekend to Monday’s open', () => {
    // Friday 20 Nov 2026 21:30 UTC is 16:30 in New York; it reopens Monday 09:30 EST (14:30 UTC).
    const now = Date.parse('2026-11-20T21:30:00Z');
    const reopen = Date.parse('2026-11-23T14:30:00Z');
    expect(sessionState(newYork, now)).toEqual({
      open: false,
      minutesToChange: (reopen - now) / 60_000,
    });
  });
});

describe('sessionsOnClock', () => {
  it('places New York’s session on a viewer clock in Dubai (UTC+4)', () => {
    const now = Date.parse('2026-11-16T10:00:00Z');
    expect(utcOffset(now, 'Asia/Dubai')).toBe(240);
    // 09:30–16:00 EST is 18:30–01:00 in Dubai: the arc wraps past midnight.
    expect(sessionsOnClock(newYork, now, 240)).toEqual([[18 * 60 + 30, 18 * 60 + 30 + 390]]);
    expect(sessionsOnClock(crypto, now, 240)).toEqual([[0, 1440]]);
  });
});
