import type { SymbolRef } from '../feeds/types';

/** A symbol with what the interface needs to show it honestly. */
export interface Instrument extends SymbolRef {
  /** Display label: 'BTC/USD', 'BTC/USDT', 'EUR/USD'. The quote currency is always shown. */
  label: string;
  name: string;
  /** Price decimals. */
  decimals: number;
  /** Shown beside the label when the instrument stands in for something else. */
  note?: string;
  /** SEC Central Index Key, for filings through the edge (`/sec?cik=`). */
  cik?: number;
}

const crypto = (
  base: string,
  quote: string,
  name: string,
  decimals = 2,
  note?: string,
): Instrument => ({
  id: `${base}-${quote}`,
  kind: 'crypto',
  base,
  quote,
  label: `${base}/${quote}`,
  name,
  decimals,
  ...(note === undefined ? {} : { note }),
});

const fx = (base: string, quote: string, decimals = 5): Instrument => ({
  id: `${base}-${quote}`,
  kind: 'fx',
  base,
  quote,
  label: `${base}/${quote}`,
  name: `${base} / ${quote} (Kraken spot)`,
  decimals,
  note: 'exchange FX',
});
const equity = (
  ticker: string,
  name: string,
  extra: { cik?: number; note?: string } = {},
): Instrument => ({
  id: ticker,
  kind: 'equity',
  base: ticker,
  quote: 'USD',
  label: ticker,
  name,
  decimals: 2,
  ...extra,
});

/** Crypto and FX need no key; US stocks and ETF proxies stream with an Alpaca or Finnhub key. */
export const INSTRUMENTS: readonly Instrument[] = [
  crypto('BTC', 'USD', 'Bitcoin'),
  crypto('ETH', 'USD', 'Ether'),
  crypto('SOL', 'USD', 'Solana', 3),
  crypto('XRP', 'USD', 'XRP', 4),
  crypto('DOGE', 'USD', 'Dogecoin', 5),
  crypto('ADA', 'USD', 'Cardano', 4),
  crypto('AVAX', 'USD', 'Avalanche', 3),
  crypto('LINK', 'USD', 'Chainlink', 3),
  crypto('PAXG', 'USD', 'PAX Gold', 2, 'gold proxy'),
  crypto('BTC', 'USDT', 'Bitcoin'),
  crypto('ETH', 'USDT', 'Ether'),
  crypto('SOL', 'USDT', 'Solana', 3),
  crypto('PAXG', 'USDT', 'PAX Gold', 2, 'gold proxy'),
  fx('EUR', 'USD'),
  fx('GBP', 'USD'),
  fx('USD', 'JPY', 3),
  fx('USD', 'CHF'),
  fx('USD', 'CAD'),
  fx('AUD', 'USD'),
  fx('EUR', 'GBP'),
  fx('EUR', 'JPY', 3),
  fx('EUR', 'CHF'),
  fx('EUR', 'CAD'),
  fx('EUR', 'AUD'),
  fx('AUD', 'JPY', 3),
  // CIKs from SEC's company_tickers.json (16 Nov 2026). QQQ and IWM are fund series it omits.
  equity('SPY', 'SPDR S&P 500 ETF', { cik: 884394, note: 'S&P 500 proxy' }),
  equity('QQQ', 'Invesco QQQ Trust', { note: 'Nasdaq-100 proxy' }),
  equity('DIA', 'SPDR Dow Jones Industrial Average ETF', { cik: 1041130, note: 'Dow proxy' }),
  equity('IWM', 'iShares Russell 2000 ETF', { note: 'Russell 2000 proxy' }),
  equity('USO', 'United States Oil Fund', { cik: 1327068, note: 'oil proxy, US hours' }),
  equity('AAPL', 'Apple', { cik: 320193 }),
  equity('MSFT', 'Microsoft', { cik: 789019 }),
  equity('NVDA', 'NVIDIA', { cik: 1045810 }),
  equity('AMZN', 'Amazon', { cik: 1018724 }),
  equity('GOOGL', 'Alphabet', { cik: 1652044 }),
  equity('META', 'Meta Platforms', { cik: 1326801 }),
  equity('TSLA', 'Tesla', { cik: 1318605 }),
  equity('AMD', 'Advanced Micro Devices', { cik: 2488 }),
  equity('NFLX', 'Netflix', { cik: 1065280 }),
  equity('JPM', 'JPMorgan Chase', { cik: 19617 }),
  equity('V', 'Visa', { cik: 1403161 }),
  equity('XOM', 'Exxon Mobil', { cik: 2115436 }),
];

const byId = new Map(INSTRUMENTS.map((instrument) => [instrument.id, instrument]));

export function instrument(id: string): Instrument | undefined {
  return byId.get(id);
}

/** Instruments for a list of ids, skipping unknown ones (e.g. from an old saved layout). */
export function instruments(ids: readonly string[]): Instrument[] {
  return ids.flatMap((id) => {
    const found = byId.get(id);
    return found ? [found] : [];
  });
}
