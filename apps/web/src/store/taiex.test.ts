import { describe, expect, it } from 'vitest';
import { parseTaiex, rocDate } from './taiex';

/** TWSE's open-data CSV as served on 17 Nov 2026 (first rows of November). */
const CSV = [
  '日期,開盤指數,最高指數,最低指數,收盤指數',
  '"1151102","45034.53","45156.17","44399.10","44920.14"',
  '"1151103","44481.59","44614.64","43191.58","43307.54"',
  '"1151104","43449.45","43741.54","41855.82","42948.91"',
  '',
].join('\r\n');

describe('TWSE TAIEX open data', () => {
  it('reads Taiwan’s ROC calendar dates (year 115 is 2026)', () => {
    expect(rocDate('1151102')).toBe('2026-11-02');
    expect(rocDate('991231')).toBe('2010-12-31');
    expect(rocDate('20261102')).toBeNull();
  });

  it('reads closes oldest first and skips the header and blank lines', () => {
    expect(parseTaiex(CSV)).toEqual([
      { date: '2026-11-02', close: 44920.14 },
      { date: '2026-11-03', close: 43307.54 },
      { date: '2026-11-04', close: 42948.91 },
    ]);
    expect(parseTaiex('日期,開盤指數,最高指數,最低指數,收盤指數\n"bad","x","x","x","x"')).toEqual(
      [],
    );
  });
});
