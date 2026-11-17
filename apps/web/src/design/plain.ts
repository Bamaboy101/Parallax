import type { Instrument } from '../store/symbols';

/** Currency names for plain labels: the thing priced, and the unit it is priced in. */
const CURRENCY: Readonly<Record<string, readonly [name: string, units: string]>> = {
  USD: ['US dollar', 'dollars'],
  EUR: ['Euro', 'dollars'],
  GBP: ['British pound', 'pounds'],
  JPY: ['Japanese yen', 'yen'],
  CHF: ['Swiss franc', 'francs'],
  CAD: ['Canadian dollar', 'Canadian dollars'],
  AUD: ['Australian dollar', 'Australian dollars'],
};

const units = (code: string): string =>
  code === 'USD' || code === 'USDT' ? 'dollars' : (CURRENCY[code]?.[1] ?? code);

/**
 * What someone without a finance background would call it: "Bitcoin", "Gold", "Euro, in
 * dollars". The trading label (BTC/USD) stays available as a tooltip.
 */
export function plainName(item: Instrument): string {
  // The same coin also trades against USDT (a dollar token); say so, or the list shows it twice.
  const tether = item.quote === 'USDT' ? ', in USDT' : '';
  if (item.base === 'PAXG') return `Gold${tether}`;
  if (item.kind === 'fx') {
    const name = CURRENCY[item.base]?.[0] ?? item.base;
    return `${name}, in ${units(item.quote)}`;
  }
  return `${item.name}${tether}`;
}

/** "+2.10%" with the sign spelled out for screen readers: "up 2.10%". */
export function changeWords(changePct: number, decimals = 2): string {
  const size = Math.abs(changePct).toFixed(decimals);
  if (Number(size) === 0) return 'flat';
  return `${changePct > 0 ? 'up' : 'down'} ${size}%`;
}
