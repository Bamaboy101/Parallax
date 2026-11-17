import { isObject } from '../../feeds/adapters/parse';

/**
 * Alpaca's indicative options feed (M2), parsed. On the free plan Alpaca serves "a free
 * derivative of the original OPRA feed": quotes are adjusted, trades delayed by 15 minutes.
 */
export interface OptionQuote {
  /** OCC symbol, e.g. SPY261120C00730000. */
  symbol: string;
  type: 'call' | 'put';
  strike: number;
  /** 'YYYY-MM-DD' */
  expiry: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** Epoch ms of the latest (15-minute delayed) trade. */
  lastAt: number | null;
  quoteAt: number | null;
  /** Implied volatility as a fraction (0.31 is 31%); absent when Alpaca has none. */
  iv: number | null;
  delta: number | null;
  /** Contracts traded in the session the daily bar covers. */
  volume: number;
  /** 'YYYY-MM-DD' of that session, or null without a daily bar. */
  volumeDay: string | null;
}

/** OCC option symbol: root, YYMMDD, C or P, strike × 1000 in eight digits. */
export function parseOcc(
  symbol: string,
): { root: string; expiry: string; type: 'call' | 'put'; strike: number } | null {
  const match = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
  if (!match) return null;
  const [, root = '', yy = '', mm = '', dd = '', side, strike = ''] = match;
  return {
    root,
    expiry: `20${yy}-${mm}-${dd}`,
    type: side === 'C' ? 'call' : 'put',
    strike: Number(strike) / 1000,
  };
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const time = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

/** One snapshot from `/v1beta1/options/snapshots/{underlying}`. */
export function parseSnapshot(symbol: string, body: unknown): OptionQuote | null {
  const occ = parseOcc(symbol);
  if (!occ || !isObject(body)) return null;
  const quote = isObject(body.latestQuote) ? body.latestQuote : {};
  const trade = isObject(body.latestTrade) ? body.latestTrade : {};
  const greeks = isObject(body.greeks) ? body.greeks : {};
  const daily = isObject(body.dailyBar) ? body.dailyBar : null;
  const bid = num(quote.bp);
  const ask = num(quote.ap);
  return {
    symbol,
    type: occ.type,
    strike: occ.strike,
    expiry: occ.expiry,
    // A zero bid or ask means no one is quoting that side.
    bid: bid === 0 ? null : bid,
    ask: ask === 0 ? null : ask,
    last: num(trade.p),
    lastAt: time(trade.t),
    quoteAt: time(quote.t),
    iv: num(body.impliedVolatility),
    delta: num(greeks.delta),
    volume: daily ? (num(daily.v) ?? 0) : 0,
    volumeDay: daily && typeof daily.t === 'string' ? daily.t.slice(0, 10) : null,
  };
}

export interface ChainPage {
  quotes: OptionQuote[];
  next: string | null;
}

/** `{ snapshots: { SYMBOL: snapshot }, next_page_token }` → quotes. */
export function parseChain(body: unknown): ChainPage {
  if (!isObject(body) || !isObject(body.snapshots)) throw new Error('unexpected option chain');
  const quotes = Object.entries(body.snapshots).flatMap(([symbol, snapshot]) => {
    const quote = parseSnapshot(symbol, snapshot);
    return quote ? [quote] : [];
  });
  return {
    quotes,
    next: typeof body.next_page_token === 'string' ? body.next_page_token : null,
  };
}

/** The underlying's last trade from `/v2/stocks/{symbol}/snapshot` (IEX on the free plan). */
export function parseSpot(body: unknown): { price: number; at: number } | null {
  if (!isObject(body) || !isObject(body.latestTrade)) return null;
  const price = num(body.latestTrade.p);
  const at = time(body.latestTrade.t);
  return price === null || at === null ? null : { price, at };
}

export interface ChainRow {
  strike: number;
  call: OptionQuote | null;
  put: OptionQuote | null;
}

/** Calls and puts side by side, by strike, lowest first. */
export function chainRows(quotes: readonly OptionQuote[]): ChainRow[] {
  const byStrike = new Map<number, ChainRow>();
  for (const quote of quotes) {
    const row = byStrike.get(quote.strike) ?? { strike: quote.strike, call: null, put: null };
    row[quote.type] = quote;
    byStrike.set(quote.strike, row);
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

/** Expiries present in a set of quotes, soonest first. */
export const expiriesOf = (quotes: readonly OptionQuote[]): string[] =>
  [...new Set(quotes.map((quote) => quote.expiry))].sort();

export interface SmilePoint {
  strike: number;
  iv: number;
  type: 'call' | 'put';
}

/**
 * The implied-volatility smile: out-of-the-money options only, as traders read it (puts below
 * the spot, calls at and above it), since in-the-money contracts trade thinly and their IV is
 * noisy.
 */
export function smile(rows: readonly ChainRow[], spot: number): SmilePoint[] {
  return rows.flatMap((row): SmilePoint[] => {
    const side = row.strike < spot ? row.put : row.call;
    return side?.iv != null && side.iv > 0
      ? [{ strike: row.strike, iv: side.iv, type: side.type }]
      : [];
  });
}

export interface PutCall {
  callVolume: number;
  putVolume: number;
  /** Puts traded per call; null while no call has traded. */
  ratio: number | null;
  /** The session the volumes belong to. */
  day: string | null;
}

/** Put/call ratio by contracts traded in the latest session the quotes cover. */
export function putCallRatio(quotes: readonly OptionQuote[]): PutCall {
  const day = quotes.reduce<string | null>(
    (latest, quote) =>
      quote.volumeDay !== null && (latest === null || quote.volumeDay > latest)
        ? quote.volumeDay
        : latest,
    null,
  );
  let callVolume = 0;
  let putVolume = 0;
  for (const quote of quotes) {
    if (quote.volumeDay !== day) continue;
    if (quote.type === 'call') callVolume += quote.volume;
    else putVolume += quote.volume;
  }
  return { callVolume, putVolume, ratio: callVolume > 0 ? putVolume / callVolume : null, day };
}

/** The strike nearest the spot: the at-the-money row. */
export function atTheMoney(rows: readonly ChainRow[], spot: number): number | null {
  let best: number | null = null;
  for (const row of rows) {
    if (best === null || Math.abs(row.strike - spot) < Math.abs(best - spot)) best = row.strike;
  }
  return best;
}
