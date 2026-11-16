import type { SymbolRef } from '../feeds/types';

/** A USDT perpetual future. Kept apart from the spot catalogue: no chart or watchlist feed has it. */
export interface Perp extends SymbolRef {
  /** 'BTC/USDT perp': the quote is always shown. */
  label: string;
  name: string;
  /** Mark price decimals. */
  decimals: number;
}

const perp = (base: string, name: string, decimals: number): Perp => ({
  id: `${base}-USDT-PERP`,
  kind: 'perp',
  base,
  quote: 'USDT',
  label: `${base}/USDT perp`,
  name,
  decimals,
});

/** The perps on the derivatives board: the largest, listed on Bybit, OKX and Binance alike. */
export const PERPS: readonly Perp[] = [
  perp('BTC', 'Bitcoin', 1),
  perp('ETH', 'Ether', 2),
  perp('SOL', 'Solana', 3),
  perp('XRP', 'XRP', 4),
  perp('DOGE', 'Dogecoin', 5),
];
