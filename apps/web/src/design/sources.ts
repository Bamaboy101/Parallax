/** Display names for feed source ids and key-vault ids. Unknown ids show as given. */
const NAMES: Readonly<Record<string, string>> = {
  alpaca: 'Alpaca',
  'alpaca-poll': 'Alpaca snapshots',
  finnhub: 'Finnhub',
  binance: 'Binance',
  'binance-futures': 'Binance futures',
  bybit: 'Bybit',
  okx: 'OKX',
  coinbase: 'Coinbase',
  kraken: 'Kraken',
  ecb: 'ECB',
  fred: 'FRED',
};

export const sourceName = (id: string): string => NAMES[id] ?? id;

/** 'alpaca,finnhub' → 'Alpaca or Finnhub'. */
export function sourceNames(ids: string, joiner = 'or'): string {
  const names = ids.split(',').filter(Boolean).map(sourceName);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${joiner} ${names.at(-1) ?? ''}`;
}
