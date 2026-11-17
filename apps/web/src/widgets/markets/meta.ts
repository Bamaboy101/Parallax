import type { WidgetMeta } from '../types';

export const meta: WidgetMeta = {
  id: 'markets',
  title: 'World markets',
  defaultSize: { width: 420, height: 560 },
  aliases: ['markets', 'world', 'indices', 'sectors', 'bonds', 'commodities'],
  dock: true,
  input: 'none',
  learn:
    'World markets through US-listed funds: each row is a fund that tracks an index, sector, bond market or commodity. They trade only in New York hours.',
};

/** One board row: a US-listed ETF and the market it stands in for. */
export interface BoardRow {
  id: string;
  /** What the ETF is a proxy for. */
  market: string;
}

export interface BoardGroup {
  title: string;
  rows: BoardRow[];
}

const rows = (pairs: [string, string][]): BoardRow[] =>
  pairs.map(([id, market]) => ({ id, market }));

export const GROUPS: readonly BoardGroup[] = [
  {
    title: 'World indices',
    rows: rows([
      ['SPY', 'S&P 500'],
      ['QQQ', 'Nasdaq-100'],
      ['DIA', 'Dow Jones'],
      ['IWM', 'Russell 2000'],
      ['EWJ', 'Japan'],
      ['FXI', 'China large-cap'],
      ['INDA', 'India'],
      ['EWG', 'Germany'],
      ['EWU', 'United Kingdom'],
      ['EEM', 'Emerging markets'],
    ]),
  },
  {
    title: 'US sectors',
    rows: rows([
      ['XLK', 'Technology'],
      ['XLF', 'Financials'],
      ['XLV', 'Health care'],
      ['XLY', 'Consumer discretionary'],
      ['XLP', 'Consumer staples'],
      ['XLE', 'Energy'],
      ['XLI', 'Industrials'],
      ['XLB', 'Materials'],
      ['XLU', 'Utilities'],
      ['XLRE', 'Real estate'],
      ['XLC', 'Communication services'],
    ]),
  },
  {
    title: 'Bonds',
    rows: rows([
      ['TLT', 'Treasuries 20+ yr'],
      ['IEF', 'Treasuries 7–10 yr'],
      ['SHY', 'Treasuries 1–3 yr'],
      ['HYG', 'High-yield corporates'],
      ['LQD', 'Investment-grade corporates'],
    ]),
  },
  {
    title: 'Commodities',
    rows: rows([
      ['GLD', 'Gold'],
      ['SLV', 'Silver'],
      ['USO', 'WTI crude oil'],
      ['UNG', 'Natural gas'],
      ['DBA', 'Agriculture'],
    ]),
  },
];
