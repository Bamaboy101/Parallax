import { isObject, type Json } from '../../feeds/adapters/parse';

/** Alpaca sends money and quantities as decimal strings. */
const amount = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface PaperAccount {
  status: string;
  equity: number;
  /** Equity at the previous close: today's profit and loss is equity minus this. */
  lastEquity: number;
  buyingPower: number;
  cash: number;
  tradingBlocked: boolean;
}

export function parseAccount(body: unknown): PaperAccount {
  if (!isObject(body)) throw new Error('unexpected account answer');
  const equity = amount(body.equity);
  const lastEquity = amount(body.last_equity);
  if (equity === null || lastEquity === null) throw new Error('account has no equity');
  return {
    status: text(body.status),
    equity,
    lastEquity,
    buyingPower: amount(body.buying_power) ?? 0,
    cash: amount(body.cash) ?? 0,
    tradingBlocked: body.trading_blocked === true || body.account_blocked === true,
  };
}

export interface PaperPosition {
  symbol: string;
  side: 'long' | 'short';
  /** Shares, negative for a short. */
  qty: number;
  avgEntry: number;
  price: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  /** As a fraction: 0.05 is +5%. */
  unrealizedPlPct: number | null;
  todayPl: number | null;
}

function parsePosition(entry: Json): PaperPosition | null {
  const qty = amount(entry.qty);
  const avgEntry = amount(entry.avg_entry_price);
  if (typeof entry.symbol !== 'string' || qty === null || avgEntry === null) return null;
  return {
    symbol: entry.symbol,
    side: entry.side === 'short' ? 'short' : 'long',
    qty,
    avgEntry,
    price: amount(entry.current_price),
    marketValue: amount(entry.market_value),
    unrealizedPl: amount(entry.unrealized_pl),
    unrealizedPlPct: amount(entry.unrealized_plpc),
    todayPl: amount(entry.unrealized_intraday_pl),
  };
}

export function parsePositions(body: unknown): PaperPosition[] {
  if (!Array.isArray(body)) throw new Error('unexpected positions answer');
  return body.flatMap((entry) => (isObject(entry) ? (parsePosition(entry) ?? []) : []));
}

export interface PaperOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  qty: number | null;
  filledQty: number;
  limitPrice: number | null;
  status: string;
  submittedAt: number | null;
}

export function parseOrder(entry: unknown): PaperOrder | null {
  if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.symbol !== 'string')
    return null;
  const submitted =
    typeof entry.submitted_at === 'string' ? Date.parse(entry.submitted_at) : Number.NaN;
  return {
    id: entry.id,
    symbol: entry.symbol,
    side: entry.side === 'sell' ? 'sell' : 'buy',
    type: text(entry.type),
    qty: amount(entry.qty),
    filledQty: amount(entry.filled_qty) ?? 0,
    limitPrice: amount(entry.limit_price),
    status: text(entry.status),
    submittedAt: Number.isNaN(submitted) ? null : submitted,
  };
}

export function parseOrders(body: unknown): PaperOrder[] {
  if (!Array.isArray(body)) throw new Error('unexpected orders answer');
  return body.flatMap((entry) => parseOrder(entry) ?? []);
}

/** What the order ticket submits. */
export interface Ticket {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  qty: number;
  limitPrice?: number;
}

/**
 * A ticket as Alpaca's order body, or the reason it cannot be sent. Whole shares only; day
 * orders (a day order sent after the close waits for the next session). Limit prices follow the
 * tick rules: cents at $1 and above, four decimals below.
 */
export function orderBody(ticket: Ticket): { body: Record<string, string> } | { error: string } {
  if (!/^[A-Z][A-Z.]{0,9}$/.test(ticket.symbol))
    return { error: 'Paper trading covers US stocks and ETFs.' };
  if (!Number.isInteger(ticket.qty) || ticket.qty < 1)
    return { error: 'Quantity must be a whole number of shares, 1 or more.' };
  const body: Record<string, string> = {
    symbol: ticket.symbol,
    qty: String(ticket.qty),
    side: ticket.side,
    type: ticket.type,
    time_in_force: 'day',
  };
  if (ticket.type === 'limit') {
    const price = ticket.limitPrice;
    if (price === undefined || !Number.isFinite(price) || price <= 0)
      return { error: 'Enter a limit price above zero.' };
    const decimals = price >= 1 ? 2 : 4;
    const scaled = price * 10 ** decimals;
    // Tolerance for binary floating point: 12.34 * 100 is 1233.9999999999998.
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
      return {
        error:
          price >= 1
            ? 'Limit prices at $1 and above go in whole cents.'
            : 'Limit prices below $1 take at most four decimals.',
      };
    }
    body.limit_price = price.toFixed(decimals);
  }
  return { body };
}
