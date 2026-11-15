/** Data freshness shown on every truth badge. The hub decides `stale` for live sources. */
export type Freshness =
  | { kind: 'live'; ageMs: number; stale?: boolean }
  | { kind: 'delayed'; minutes: number }
  | { kind: 'eod' }
  | { kind: 'offline' };

export type BadgeTone = 'live' | 'warn' | 'offline';

/** 140 → "140ms", 2_340 → "2.3s", 125_000 → "2m". */
export function formatAge(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 1000) return `${String(Math.round(clamped))}ms`;
  if (clamped < 60_000) return `${(clamped / 1000).toFixed(1)}s`;
  return `${String(Math.floor(clamped / 60_000))}m`;
}

export function badgeLabel(freshness: Freshness): string {
  switch (freshness.kind) {
    case 'live':
      return `LIVE ${formatAge(freshness.ageMs)}`;
    case 'delayed':
      return `DELAYED ${String(freshness.minutes)}m`;
    case 'eod':
      return 'EOD';
    case 'offline':
      return 'OFFLINE';
  }
}

/** Cyan when live, amber when stale or delayed, grey when offline. */
export function badgeTone(freshness: Freshness): BadgeTone {
  switch (freshness.kind) {
    case 'live':
      return freshness.stale ? 'warn' : 'live';
    case 'delayed':
    case 'eod':
      return 'warn';
    case 'offline':
      return 'offline';
  }
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** Fixed-decimal number for display. Null or non-finite values render as an em dash. */
export function formatNumber(
  value: number | null | undefined,
  decimals = 2,
  signed = false,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const key = `${String(decimals)}:${String(signed)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    numberFormats.set(key, format);
  }
  return format.format(value);
}
