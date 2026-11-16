import type { AdapterRegistration } from '../types';
import { ALPACA_SYMBOL_LIMIT, AlpacaAdapter } from './alpaca';
import { BinanceAdapter } from './binance';
import { CoinbaseAdapter } from './coinbase';
import { FINNHUB_SYMBOL_LIMIT, FinnhubAdapter } from './finnhub';
import { KrakenAdapter } from './kraken';
import { usMarketOpen } from './marketHours';

/** Crypto feeds trade around the clock: stale after 5 s of silence. */
const CRYPTO_STALE = { staleAfterMs: 5000 };
/** US stock feeds: stale after 30 s, counted only during the regular session. */
const EQUITY_STALE = { staleAfterMs: 30_000, isActive: usMarketOpen };

/**
 * Every feed the hub runs. Adding a feed is one adapter file plus one entry here; the router
 * decides which feed serves which symbol.
 */
export const registrations: AdapterRegistration[] = [
  { factory: (ctx) => new CoinbaseAdapter(ctx), stale: CRYPTO_STALE },
  { factory: (ctx) => new BinanceAdapter(ctx), stale: CRYPTO_STALE },
  { factory: (ctx) => new KrakenAdapter(ctx), stale: CRYPTO_STALE },
  {
    factory: (ctx) => new AlpacaAdapter(ctx),
    stale: EQUITY_STALE,
    symbolLimit: ALPACA_SYMBOL_LIMIT,
  },
  {
    factory: (ctx) => new FinnhubAdapter(ctx),
    stale: EQUITY_STALE,
    symbolLimit: FINNHUB_SYMBOL_LIMIT,
  },
];
