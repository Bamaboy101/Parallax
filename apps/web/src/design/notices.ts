import type { Availability } from '../store/availability';
import type { Failure } from '../store/failure';
import { sourceName, sourceNames } from './sources';

/**
 * What a panel says when it has nothing to show. `tone`: info (setup or waiting), warn (a limit
 * or a rejected key, amber like stale data), offline (grey). `action: 'settings'` adds a button
 * that opens Settings.
 */
export interface Notice {
  tone: 'info' | 'warn' | 'offline';
  title: string;
  detail?: string;
  action?: 'settings';
}

const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const retrying = (retryAt: number | null) =>
  retryAt === null ? 'Retrying shortly.' : `Retrying at ${clock.format(retryAt)}.`;

const networkDown = () => typeof navigator !== 'undefined' && !navigator.onLine;

/** Why `subject` (e.g. 'AAPL', 'These ETFs') has no live data, or null when it is just quiet. */
export function availabilityNotice(availability: Availability, subject: string): Notice | null {
  switch (availability.kind) {
    case 'starting':
      return { tone: 'info', title: 'Connecting…' };
    case 'connecting':
      return { tone: 'info', title: `Connecting to ${sourceName(availability.source)}…` };
    case 'live':
      return null;
    case 'no-key':
      return {
        tone: 'info',
        title: `Add a free ${sourceNames(availability.keys)} key to see ${subject}`,
        detail: 'In Settings. Keys stay in this browser and go only to their provider.',
        action: 'settings',
      };
    case 'key-rejected':
      return {
        tone: 'warn',
        title: `${sourceNames(availability.keys, 'and')} rejected the stored key`,
        detail: 'Check or replace it in Settings.',
        action: 'settings',
      };
    case 'capped':
      return {
        tone: 'warn',
        title: `${sourceName(availability.source)}'s free plan streams ${String(availability.limit)} symbols`,
        detail: `Waiting for a free slot for ${subject}: close a panel that uses one, or add another provider's key.`,
        action: 'settings',
      };
    case 'rate-limited':
      return {
        tone: 'warn',
        title: `${sourceName(availability.source)} rate limit reached`,
        detail: retrying(availability.retryAt),
      };
    case 'offline':
      return networkDown()
        ? {
            tone: 'offline',
            title: 'No network connection',
            detail: 'Reconnecting when it is back.',
          }
        : { tone: 'offline', title: 'Feed offline', detail: retrying(availability.retryAt) };
    case 'unsupported':
      return { tone: 'info', title: `No free live feed carries ${subject}` };
  }
}

/** A row's short reason in place of a price, with the full sentence as its tooltip. */
export function availabilityLabel(
  availability: Availability,
  subject: string,
): { text: string; title: string; tone: Notice['tone'] } | null {
  const notice = availabilityNotice(availability, subject);
  if (!notice) return null;
  const text: Record<Availability['kind'], string> = {
    starting: '…',
    connecting: '…',
    live: '',
    'no-key': 'Needs key',
    'key-rejected': 'Key rejected',
    capped: 'Cap full',
    'rate-limited': 'Rate limited',
    offline: 'Offline',
    unsupported: 'No feed',
  };
  return {
    text: text[availability.kind],
    title: notice.detail ? `${notice.title}. ${notice.detail}` : notice.title,
    tone: notice.tone,
  };
}

/** Why a REST request for `what` (e.g. 'Headlines', 'FRED') failed. */
export function failureNotice(failure: Failure, what: string): Notice {
  switch (failure.kind) {
    case 'rate-limited':
      return {
        tone: 'warn',
        title: `${what}: rate limit reached`,
        detail: retrying(failure.retryAt),
      };
    case 'offline':
      return {
        tone: 'offline',
        title: networkDown() ? 'No network connection' : `${what} can't be reached`,
        detail: 'Trying again on the next refresh.',
      };
    case 'no-source':
      return {
        tone: 'info',
        title: `${what} needs a free key`,
        detail: 'Add an Alpaca or Finnhub key in Settings.',
        action: 'settings',
      };
    case 'unconfigured':
      return { tone: 'info', title: `${what} isn't connected yet`, detail: failure.message };
    case 'error':
      return { tone: 'warn', title: `${what} is unavailable`, detail: failure.message };
  }
}
