import type { SymbolRef } from './types';

/**
 * Preferred feeds for a symbol, best first. The hub skips feeds that are not registered, do not
 * support the symbol, lack a key or are down, and fails over down this list.
 *
 * USD crypto never routes to Binance: Binance quotes USDT, and a USDT price is never shown under
 * a USD label.
 */
export function routeOrder(symbol: SymbolRef): string[] {
  switch (symbol.kind) {
    case 'crypto':
      if (symbol.quote === 'USD') return ['coinbase', 'kraken'];
      if (symbol.quote === 'USDT') return ['binance', 'kraken'];
      return [];
    case 'fx':
      return ['kraken'];
    case 'equity':
      // Streams first; the snapshot poller takes what both streams have no room for.
      return ['alpaca', 'finnhub', 'alpaca-poll'];
  }
}
