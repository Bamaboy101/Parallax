import { formatNumber } from '../../design/format';
import { INSTRUMENTS, instrument, type Instrument } from '../symbols';

/**
 * F7 smart alerts, written in plain words:
 * - `BTC above 65000`, `AAPL below 180`, `eur/usd over 1.10`, `eth > 2k`
 * - `ETH down 2% in 15m`, `SOL moves 3% within 1 hour` (the store keeps an hour of prices)
 * - `BTC up 5% today` (24 hours for crypto and FX, since the previous close for US stocks)
 */
export type AlertRule =
  | { kind: 'level'; symbol: string; direction: 'above' | 'below'; level: number }
  | {
      kind: 'move';
      symbol: string;
      direction: 'up' | 'down' | 'either';
      percent: number;
      windowMs: number;
    }
  | { kind: 'day'; symbol: string; direction: 'up' | 'down' | 'either'; percent: number };

export type ParseResult = { ok: true; rule: AlertRule } | { ok: false; reason: string };

/** The longest window a move alert can watch: the tick store keeps an hour. */
export const MAX_WINDOW_MS = 60 * 60_000;

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A symbol by exact ticker, pair or label only; never a fuzzy match, so an alert cannot land on
 * the wrong instrument. USD pairs win ("btc" is BTC/USD, not BTC/USDT).
 */
export function resolveSymbol(token: string): Instrument | undefined {
  const query = squash(token);
  if (query === '') return undefined;
  const matches = INSTRUMENTS.filter(
    (item) =>
      squash(item.id) === query ||
      squash(item.label) === query ||
      squash(item.base + item.quote) === query ||
      item.base.toLowerCase() === query,
  );
  return matches.find((item) => item.quote === 'USD') ?? matches[0];
}

const number = (text: string): number | null => {
  const match = /^\$?([\d,]*\.?\d+)(k|m)?$/i.exec(text);
  if (!match) return null;
  const [, digits = '', scale = ''] = match;
  const value = Number(digits.replace(/,/g, ''));
  const multiplier = scale.toLowerCase() === 'k' ? 1e3 : scale.toLowerCase() === 'm' ? 1e6 : 1;
  return Number.isFinite(value) ? value * multiplier : null;
};

const UP = new Set(['up', 'rises', 'rise', 'gains', 'gain', 'jumps', 'jump']);
const DOWN = new Set(['down', 'falls', 'fall', 'drops', 'drop', 'loses', 'lose']);
const EITHER = new Set(['moves', 'move', 'swings', 'swing']);

function directionOf(word: string): 'up' | 'down' | 'either' | null {
  if (UP.has(word)) return 'up';
  if (DOWN.has(word)) return 'down';
  if (EITHER.has(word)) return 'either';
  return null;
}

/** "15m", "15 min", "1 hour", "2h" → ms. */
function windowOf(amount: string, unit: string): number | null {
  const value = amount === 'a' || amount === 'an' ? 1 : Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (/^(m|min|mins|minute|minutes)$/.test(unit)) return value * 60_000;
  if (/^(h|hr|hrs|hour|hours)$/.test(unit)) return value * 3_600_000;
  return null;
}

/** Parse plain words into a rule, or say what is missing. */
export function parseAlert(text: string): ParseResult {
  const words = text
    .trim()
    .toLowerCase()
    .replace(/^(alert|notify|tell me|when|if)\s+/, '')
    .replace(/(\d)\s*%/g, '$1 %')
    .replace(/(\d)(m|min|mins|h|hr|hrs)\b/g, '$1 $2')
    .split(/\s+/)
    .filter(
      (word) => word !== '' && !['is', 'goes', 'trades', 'crosses', 'by', 'the'].includes(word),
    );
  const [symbolWord, ...rest] = words;
  if (!symbolWord) return { ok: false, reason: 'Name a symbol, for example “BTC above 65000”.' };
  const item = resolveSymbol(symbolWord);
  if (!item) return { ok: false, reason: `No symbol called “${symbolWord}” in the terminal.` };
  const [verb = '', ...tail] = rest;

  if (['above', 'over', '>', 'below', 'under', '<'].includes(verb)) {
    const level = number(tail.join(''));
    if (level === null || level <= 0)
      return { ok: false, reason: 'Give a price, for example “above 65000” or “below 1.08”.' };
    return {
      ok: true,
      rule: {
        kind: 'level',
        symbol: item.id,
        direction: ['above', 'over', '>'].includes(verb) ? 'above' : 'below',
        level,
      },
    };
  }

  const direction = directionOf(verb);
  if (direction) {
    const [amount = '', percentSign = '', ...when] = tail;
    const percent = Number(amount);
    if (percentSign !== '%' || !Number.isFinite(percent) || percent <= 0) {
      return { ok: false, reason: 'Give a percentage, for example “down 2% in 15m”.' };
    }
    const span = when.filter((word) => !['in', 'within', 'over', 'on'].includes(word));
    if (span.length === 0 || ['today', 'day', '24h', '24'].includes(span[0] ?? '')) {
      return { ok: true, rule: { kind: 'day', symbol: item.id, direction, percent } };
    }
    const [count = '1', unit = ''] = span.length === 1 ? ['1', span[0] ?? ''] : span;
    const windowMs = windowOf(count, unit);
    if (windowMs === null)
      return { ok: false, reason: 'Say how long, for example “in 15m” or “within 1 hour”.' };
    if (windowMs > MAX_WINDOW_MS) {
      return {
        ok: false,
        reason: 'Moves can be watched over up to an hour; for longer, use “today”.',
      };
    }
    return { ok: true, rule: { kind: 'move', symbol: item.id, direction, percent, windowMs } };
  }

  return {
    ok: false,
    reason: 'Say “above”, “below”, “up”, “down” or “moves”, for example “ETH down 2% in 15m”.',
  };
}

const spanText = (ms: number) =>
  ms % 3_600_000 === 0
    ? `${String(ms / 3_600_000)} hour${ms === 3_600_000 ? '' : 's'}`
    : `${String(ms / 60_000)} minutes`;

/** The rule in plain words, as the user will see it in the list and the notification. */
export function describeRule(rule: AlertRule): string {
  const item = instrument(rule.symbol);
  const label = item?.label ?? rule.symbol;
  const decimals = item?.decimals ?? 2;
  switch (rule.kind) {
    case 'level':
      return `${label} trades ${rule.direction} ${formatNumber(rule.level, decimals)}`;
    case 'move': {
      const verb =
        rule.direction === 'up' ? 'rises' : rule.direction === 'down' ? 'falls' : 'moves';
      return `${label} ${verb} ${formatNumber(rule.percent, 1)}% within ${spanText(rule.windowMs)}`;
    }
    case 'day': {
      const verb =
        rule.direction === 'up' ? 'is up' : rule.direction === 'down' ? 'is down' : 'moves';
      const span = item?.kind === 'equity' ? 'since the previous close' : 'over 24 hours';
      return `${label} ${verb} ${formatNumber(rule.percent, 1)}% ${span}`;
    }
  }
}
