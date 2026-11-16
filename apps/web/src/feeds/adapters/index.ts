import type { AdapterRegistration } from '../types';
import { ALPACA_SYMBOL_LIMIT, AlpacaAdapter } from './alpaca';
import { ALPACA_POLL_MS, AlpacaPollAdapter } from './alpacaPoll';
import { BinanceAdapter } from './binance';
import { BinanceFuturesAdapter } from './binanceFutures';
import { BybitAdapter } from './bybit';
import { CoinbaseAdapter } from './coinbase';
import { FINNHUB_SYMBOL_LIMIT, FinnhubAdapter } from './finnhub';
import { KrakenAdapter } from './kraken';
import { OkxAdapter } from './okx';
import { usMarketOpen } from './marketHours';

/** Crypto feeds trade around the clock: stale after 5 s of silence. */
const CRYPTO_STALE = { staleAfterMs: 5000 };
/** US stock feeds: stale after 30 s, counted only during the regular session. */
const EQUITY_STALE = { staleAfterMs: 30_000, isActive: usMarketOpen };
/** Perp feeds: mark price updates every second or faster on all three. */
const PERP_STALE = { staleAfterMs: 10_000 };

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
  // Uncapped, last in the US stock route: serves what the streams have no room for.
  {
    factory: (ctx) => new AlpacaPollAdapter(ctx),
    stale: { staleAfterMs: 3 * ALPACA_POLL_MS, isActive: usMarketOpen },
    key: 'alpaca',
    pollMs: ALPACA_POLL_MS,
  },
  // USDT perpetuals: funding, open interest and liquidations. Public, no key.
  { factory: (ctx) => new BybitAdapter(ctx), stale: PERP_STALE },
  { factory: (ctx) => new OkxAdapter(ctx), stale: PERP_STALE },
  { factory: (ctx) => new BinanceFuturesAdapter(ctx), stale: PERP_STALE },
];
