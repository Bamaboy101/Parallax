import type { AdapterRegistration } from '../types';
import { BinanceAdapter } from './binance';
import { CoinbaseAdapter } from './coinbase';
import { KrakenAdapter } from './kraken';

/** Crypto feeds trade around the clock: stale after 5 s of silence. */
const CRYPTO_STALE = { staleAfterMs: 5000 };

/**
 * Every feed the hub runs. Adding a feed is one adapter file plus one entry here; the router
 * decides which feed serves which symbol. The equity adapters arrive in T13.
 */
export const registrations: AdapterRegistration[] = [
  { factory: (ctx) => new CoinbaseAdapter(ctx), stale: CRYPTO_STALE },
  { factory: (ctx) => new BinanceAdapter(ctx), stale: CRYPTO_STALE },
  { factory: (ctx) => new KrakenAdapter(ctx), stale: CRYPTO_STALE },
];
