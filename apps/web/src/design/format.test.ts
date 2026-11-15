import { describe, expect, it } from 'vitest';
import { badgeLabel, badgeTone, formatAge, formatNumber } from './format';

describe('formatAge', () => {
  it('switches units at 1 s and 1 min', () => {
    expect(formatAge(140)).toBe('140ms');
    expect(formatAge(999.4)).toBe('999ms');
    expect(formatAge(1000)).toBe('1.0s');
    expect(formatAge(2340)).toBe('2.3s');
    expect(formatAge(60_000)).toBe('1m');
    expect(formatAge(125_000)).toBe('2m');
  });

  it('clamps negative ages caused by clock skew to 0', () => {
    expect(formatAge(-30)).toBe('0ms');
  });
});

describe('truth badge', () => {
  it('labels each freshness kind as the plan specifies', () => {
    expect(badgeLabel({ kind: 'live', ageMs: 140 })).toBe('LIVE 140ms');
    expect(badgeLabel({ kind: 'delayed', minutes: 15 })).toBe('DELAYED 15m');
    expect(badgeLabel({ kind: 'eod' })).toBe('EOD');
    expect(badgeLabel({ kind: 'offline' })).toBe('OFFLINE');
  });

  it('is cyan when live, amber when stale or delayed, grey when offline', () => {
    expect(badgeTone({ kind: 'live', ageMs: 100 })).toBe('live');
    expect(badgeTone({ kind: 'live', ageMs: 9000, stale: true })).toBe('warn');
    expect(badgeTone({ kind: 'delayed', minutes: 15 })).toBe('warn');
    expect(badgeTone({ kind: 'eod' })).toBe('warn');
    expect(badgeTone({ kind: 'offline' })).toBe('offline');
  });
});

describe('formatNumber', () => {
  it('pads to fixed decimals with thousands separators', () => {
    expect(formatNumber(98234.5, 2)).toBe('98,234.50');
    expect(formatNumber(1.23456, 4)).toBe('1.2346');
  });

  it('signs changes only when asked, and never signs zero', () => {
    expect(formatNumber(1.5, 2, true)).toBe('+1.50');
    expect(formatNumber(-1.5, 2, true)).toBe('-1.50');
    expect(formatNumber(0, 2, true)).toBe('0.00');
    expect(formatNumber(1.5, 2)).toBe('1.50');
  });

  it('renders missing or non-finite values as a dash', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(Number.NaN)).toBe('—');
  });
});
