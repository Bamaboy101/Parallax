import { isObject } from '../../feeds/adapters/parse';

/**
 * M5 on-chain figures, parsed from three keyless sources that allow display in an app: Bitcoin
 * from mempool.space, Ethereum gas and stablecoin supply from PublicNode's Ethereum JSON-RPC, and
 * the Crypto Fear & Greed Index from alternative.me (attribution required next to it).
 */

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** sat/vB, as mempool.space recommends for each confirmation target. */
export interface BitcoinFees {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
}

export function parseBitcoinFees(json: unknown): BitcoinFees | null {
  if (!isObject(json)) return null;
  const fastest = num(json.fastestFee);
  const halfHour = num(json.halfHourFee);
  const hour = num(json.hourFee);
  const economy = num(json.economyFee);
  return fastest === null || halfHour === null || hour === null || economy === null
    ? null
    : { fastest, halfHour, hour, economy };
}

export interface Mempool {
  /** Unconfirmed transactions waiting. */
  count: number;
  /** Their size in virtual megabytes (a block holds about 1 vMB). */
  vMB: number;
}

export function parseMempool(json: unknown): Mempool | null {
  if (!isObject(json)) return null;
  const count = num(json.count);
  const vsize = num(json.vsize);
  return count === null || vsize === null ? null : { count, vMB: vsize / 1_000_000 };
}

export interface BitcoinBlock {
  height: number;
  /** Epoch ms. */
  at: number;
  txCount: number;
  /** sat/vB; null when mempool.space did not report it. */
  medianFee: number | null;
  pool: string | null;
}

export function parseBlocks(json: unknown, limit = 6): BitcoinBlock[] {
  if (!Array.isArray(json)) return [];
  return json
    .flatMap((raw): BitcoinBlock[] => {
      if (!isObject(raw)) return [];
      const height = num(raw.height);
      const timestamp = num(raw.timestamp);
      const txCount = num(raw.tx_count);
      if (height === null || timestamp === null || txCount === null) return [];
      const extras = isObject(raw.extras) ? raw.extras : {};
      const pool =
        isObject(extras.pool) && typeof extras.pool.name === 'string' ? extras.pool.name : null;
      return [{ height, at: timestamp * 1000, txCount, medianFee: num(extras.medianFee), pool }];
    })
    .sort((a, b) => b.height - a.height)
    .slice(0, limit);
}

/** A hex quantity from JSON-RPC as a BigInt, or null. */
export function hexQuantity(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  return BigInt(value);
}

const GWEI = 1_000_000_000n;
const toGwei = (wei: bigint): number => Number((wei * 1000n) / GWEI) / 1000;

/** Ethereum gas in gwei: the next block's base fee plus a priority tip for each speed. */
export interface Gas {
  /** The newest block the history covers. */
  block: number;
  baseFee: number;
  /** Priority tips: the median, over the last blocks, of their 25th, 50th and 75th percentile. */
  tips: { slow: number; standard: number; fast: number };
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/** `eth_feeHistory(n, 'latest', [25, 50, 75])`: base fees has n + 1 entries, the last one next. */
export function parseFeeHistory(result: unknown): Gas | null {
  if (!isObject(result) || !Array.isArray(result.baseFeePerGas) || !Array.isArray(result.reward))
    return null;
  const oldest = hexQuantity(result.oldestBlock);
  const next = hexQuantity(result.baseFeePerGas.at(-1));
  if (oldest === null || next === null) return null;
  const columns: [number[], number[], number[]] = [[], [], []];
  for (const row of result.reward) {
    if (!Array.isArray(row)) continue;
    row.slice(0, 3).forEach((value, index) => {
      const wei = hexQuantity(value);
      if (wei !== null) columns[index]?.push(toGwei(wei));
    });
  }
  if (columns.some((column) => column.length === 0)) return null;
  return {
    block: Number(oldest) + result.reward.length - 1,
    baseFee: toGwei(next),
    tips: { slow: median(columns[0]), standard: median(columns[1]), fast: median(columns[2]) },
  };
}

/** Stablecoins whose supply is read from their Ethereum contracts (`totalSupply()`). */
export const STABLECOINS = [
  { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
] as const;

/** `totalSupply()` as a whole-token count. Exact in BigInt, then to a number of tokens. */
export function parseSupply(result: unknown, decimals: number): number | null {
  const raw = hexQuantity(result);
  if (raw === null) return null;
  const unit = 10n ** BigInt(decimals);
  return Number(raw / unit) + Number(raw % unit) / Number(unit);
}

export interface FearGreed {
  /** 0 (extreme fear) to 100 (extreme greed). */
  value: number;
  label: string;
  /** Epoch ms of the day the reading is for. */
  date: number;
  previous: { value: number; label: string } | null;
}

/** alternative.me sends numbers as strings. */
export function parseFearGreed(json: unknown): FearGreed | null {
  if (!isObject(json) || !Array.isArray(json.data)) return null;
  const readings = json.data.flatMap((raw) => {
    if (!isObject(raw)) return [];
    const value = Number(raw.value);
    const timestamp = Number(raw.timestamp);
    const label = typeof raw.value_classification === 'string' ? raw.value_classification : '';
    return Number.isFinite(value) && Number.isFinite(timestamp) && label !== ''
      ? [{ value, label, date: timestamp * 1000 }]
      : [];
  });
  const [latest, previous] = readings;
  if (!latest) return null;
  return {
    ...latest,
    previous: previous ? { value: previous.value, label: previous.label } : null,
  };
}
