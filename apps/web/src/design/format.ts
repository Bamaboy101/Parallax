/** Data freshness shown on every truth badge. The hub decides `stale` for live sources. */
export type Freshness =
  | { kind: 'live'; ageMs: number; stale?: boolean }
  | { kind: 'delayed'; minutes: number }
  /** Fetched on a timer instead of streamed (a REST snapshot every `everyMs`). */
  | { kind: 'polled'; everyMs: number }
  /**
   * Published on a schedule, not traded: daily by default, or weekly (EIA storage) or annual
   * (World Bank, IMF). The badge reads EOD, WEEKLY or ANNUAL.
   */
  | { kind: 'eod'; cadence?: 'weekly' | 'annual' }
  /** First connection in progress; nothing has arrived yet. */
  | { kind: 'connecting' }
  /** The provider asked us to slow down (HTTP 429); retrying later. */
  | { kind: 'rate-limited' }
  /** The source needs a key: none stored, or the provider rejected it. */
  | { kind: 'no-key' }
  | { kind: 'key-rejected' }
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
    case 'polled':
      return `POLLED ${formatAge(freshness.everyMs).replace(/\.0s$/, 's')}`;
    case 'eod':
      return freshness.cadence === undefined ? 'EOD' : freshness.cadence.toUpperCase();
    case 'connecting':
      return 'CONNECTING';
    case 'rate-limited':
      return 'RATE LIMITED';
    case 'no-key':
      return 'NO KEY';
    case 'key-rejected':
      return 'KEY REJECTED';
    case 'offline':
      return 'OFFLINE';
  }
}

/**
 * Cyan when live; amber when stale, delayed, polled, rate limited or the key was rejected; grey
 * when offline, connecting or waiting for a key.
 */
export function badgeTone(freshness: Freshness): BadgeTone {
  switch (freshness.kind) {
    case 'live':
      return freshness.stale ? 'warn' : 'live';
    case 'delayed':
    case 'polled':
    case 'eod':
    case 'rate-limited':
    case 'key-rejected':
      return 'warn';
    case 'connecting':
    case 'no-key':
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

const compactFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

/** Large amounts in short form: 4_534_224_665 → "4.53B", 69_990 → "69.99K". */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return compactFormat.format(value);
}

/**
 * Higher is worse: offline or unusable (no key, rejected key), then rate limited, then stale,
 * then end-of-day or delayed, then polled or connecting, then the slowest live stream.
 */
export function badgeSeverity(freshness: Freshness): number {
  switch (freshness.kind) {
    case 'offline':
    case 'no-key':
    case 'key-rejected':
      return Number.MAX_SAFE_INTEGER;
    case 'rate-limited':
      return Number.MAX_SAFE_INTEGER / 1.5;
    case 'eod':
    case 'delayed':
      return Number.MAX_SAFE_INTEGER / 3;
    case 'polled':
    case 'connecting':
      return Number.MAX_SAFE_INTEGER / 4;
    case 'live':
      return freshness.stale ? Number.MAX_SAFE_INTEGER / 2 : freshness.ageMs;
  }
}
