import { isObject } from '../../feeds/adapters/parse';

/**
 * The rates desk (M3): the US Treasury's daily par yield curve and the New York Fed's reference
 * rates (SOFR, EFFR with the target range), both published once a business day.
 */

/** Tenors shown, shortest first: the Treasury CSV column and the label used on screen. */
export const TENORS: readonly { column: string; label: string; years: number }[] = [
  { column: '1 Mo', label: '1M', years: 1 / 12 },
  { column: '2 Mo', label: '2M', years: 2 / 12 },
  { column: '3 Mo', label: '3M', years: 3 / 12 },
  { column: '4 Mo', label: '4M', years: 4 / 12 },
  { column: '6 Mo', label: '6M', years: 6 / 12 },
  { column: '1 Yr', label: '1Y', years: 1 },
  { column: '2 Yr', label: '2Y', years: 2 },
  { column: '3 Yr', label: '3Y', years: 3 },
  { column: '5 Yr', label: '5Y', years: 5 },
  { column: '7 Yr', label: '7Y', years: 7 },
  { column: '10 Yr', label: '10Y', years: 10 },
  { column: '20 Yr', label: '20Y', years: 20 },
  { column: '30 Yr', label: '30Y', years: 30 },
];

export interface CurveDay {
  /** 'YYYY-MM-DD' */
  date: string;
  /** Percent by tenor label; null when the Treasury has no reading (a new or missing series). */
  yields: Readonly<Record<string, number | null>>;
}

/** One CSV line; the Treasury quotes headers that contain spaces. */
const cells = (line: string): string[] =>
  line.split(',').map((cell) => cell.replace(/"/g, '').trim());

/** The Treasury's "Daily Treasury Par Yield Curve Rates" CSV → days, oldest first. */
export function parseTreasuryCsv(text: string): CurveDay[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (!header) return [];
  const columns = cells(header);
  if (columns[0] !== 'Date') throw new Error('unexpected Treasury yield file');
  const index = new Map(columns.map((column, position) => [column, position]));
  const days = lines.flatMap((line): CurveDay[] => {
    const values = cells(line);
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(values[0] ?? '');
    if (!match) return [];
    const [, month = '', day = '', year = ''] = match;
    const yields = Object.fromEntries(
      TENORS.map(({ column, label }) => {
        const raw = values[index.get(column) ?? -1] ?? '';
        const value = raw === '' ? Number.NaN : Number(raw);
        return [label, Number.isFinite(value) ? value : null];
      }),
    );
    return [{ date: `${year}-${month}-${day}`, yields }];
  });
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/** Join years of curve days, oldest first, one per date. */
export function mergeCurves(...years: readonly CurveDay[][]): CurveDay[] {
  const byDate = new Map(years.flat().map((day) => [day.date, day]));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The last curve on or before `date`. */
export function curveOn(days: readonly CurveDay[], date: string): CurveDay | undefined {
  let found: CurveDay | undefined;
  for (const day of days) {
    if (day.date > date) break;
    found = day;
  }
  return found;
}

/** 'YYYY-MM-DD' a number of days before another. */
export const daysBefore = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** Change between two readings in basis points (hundredths of a percentage point). */
export const basisPoints = (now: number | null | undefined, then: number | null | undefined) =>
  now == null || then == null ? null : Math.round((now - then) * 100);

export interface RefRate {
  /** 'YYYY-MM-DD' */
  date: string;
  /** Percent. */
  rate: number;
  /** 1st and 99th percentile of the day's transactions, percent. */
  low: number | null;
  high: number | null;
  /** The FOMC's target range that day (EFFR only), percent. */
  targetFrom: number | null;
  targetTo: number | null;
  volumeBillions: number | null;
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The New York Fed's `{ refRates: [...] }` → rates, oldest first. */
export function parseRefRates(body: unknown): RefRate[] {
  if (!isObject(body) || !Array.isArray(body.refRates)) throw new Error('unexpected NY Fed answer');
  return body.refRates
    .flatMap((entry): RefRate[] => {
      if (!isObject(entry) || typeof entry.effectiveDate !== 'string') return [];
      const rate = num(entry.percentRate);
      if (rate === null) return [];
      return [
        {
          date: entry.effectiveDate,
          rate,
          low: num(entry.percentPercentile1),
          high: num(entry.percentPercentile99),
          targetFrom: num(entry.targetRateFrom),
          targetTo: num(entry.targetRateTo),
          volumeBillions: num(entry.volumeInBillions),
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface TargetChange {
  /** First day the new range applied. */
  date: string;
  from: number;
  to: number;
  /** Basis points moved, against the range before (null for the first range on record). */
  moveBp: number | null;
}

/** The FOMC target range over time: one entry per change, from the EFFR history. */
export function targetPath(effr: readonly RefRate[]): TargetChange[] {
  const path: TargetChange[] = [];
  for (const day of effr) {
    if (day.targetFrom === null || day.targetTo === null) continue;
    const last = path.at(-1);
    if (last && last.from === day.targetFrom && last.to === day.targetTo) continue;
    path.push({
      date: day.date,
      from: day.targetFrom,
      to: day.targetTo,
      moveBp: last ? Math.round((day.targetTo - last.to) * 100) : null,
    });
  }
  return path;
}
