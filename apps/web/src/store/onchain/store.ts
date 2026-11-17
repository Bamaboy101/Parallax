import { useEffect, useState } from 'react';
import { failureOf, RequestError, type Failure } from '../failure';
import { freshnessOfFailure, reportRestFreshness } from '../panels';
import {
  parseBitcoinFees,
  parseBlocks,
  parseFearGreed,
  parseFeeHistory,
  parseMempool,
  parseSupply,
  STABLECOINS,
  type BitcoinBlock,
  type BitcoinFees,
  type FearGreed,
  type Gas,
  type Mempool,
} from './parse';

/** Browser-direct: each visitor's own requests, no server in between, no copy kept. */
export const MEMPOOL_ORIGIN = 'https://mempool.space';
export const ETHEREUM_RPC = 'https://ethereum-rpc.publicnode.com';
export const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=2';
export const FEAR_GREED_PAGE = 'https://alternative.me/crypto/fear-and-greed-index/';

export const MEMPOOL_SOURCE = 'mempool';
export const ETHEREUM_SOURCE = 'publicnode';
export const FEAR_GREED_SOURCE = 'alternative-me';

/** Bitcoin blocks come about every 10 minutes; fees move faster. */
export const BITCOIN_REFRESH_MS = 30_000;
/** Ethereum makes a block every 12 s. */
export const ETHEREUM_REFRESH_MS = 15_000;
/** The index is published once a day. */
export const FEAR_GREED_REFRESH_MS = 30 * 60_000;

export interface Section<T> {
  data: T | null;
  failure: Failure | undefined;
}

export interface Onchain {
  bitcoin: Section<{ fees: BitcoinFees; mempool: Mempool | null; blocks: BitcoinBlock[] }>;
  ethereum: Section<{ gas: Gas; supply: { symbol: string; supply: number }[] }>;
  fearGreed: Section<FearGreed>;
}

const EMPTY: Onchain = {
  bitcoin: { data: null, failure: undefined },
  ethereum: { data: null, failure: undefined },
  fearGreed: { data: null, failure: undefined },
};

async function getJson(url: string, init: RequestInit | undefined, name: string): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new RequestError(`${name} answered HTTP ${String(response.status)}`, response.status);
  }
  return response.json() as Promise<unknown>;
}

/** Fees, mempool and the latest blocks. Fees are required; the rest may fail alone. */
async function loadBitcoin(): Promise<NonNullable<Onchain['bitcoin']['data']>> {
  const [fees, mempool, blocks] = await Promise.allSettled([
    getJson(`${MEMPOOL_ORIGIN}/api/v1/fees/recommended`, undefined, 'mempool.space'),
    getJson(`${MEMPOOL_ORIGIN}/api/mempool`, undefined, 'mempool.space'),
    getJson(`${MEMPOOL_ORIGIN}/api/v1/blocks`, undefined, 'mempool.space'),
  ]);
  if (fees.status === 'rejected') throw fees.reason;
  const parsed = parseBitcoinFees(fees.value);
  if (!parsed) throw new Error('mempool.space sent fees in an unexpected shape');
  return {
    fees: parsed,
    mempool: mempool.status === 'fulfilled' ? parseMempool(mempool.value) : null,
    blocks: blocks.status === 'fulfilled' ? parseBlocks(blocks.value) : [],
  };
}

/** The JSON-RPC batch: fee history for gas, then `totalSupply()` of each stablecoin. */
export function ethereumBatch(): object[] {
  return [
    { jsonrpc: '2.0', id: 0, method: 'eth_feeHistory', params: ['0x5', 'latest', [25, 50, 75]] },
    ...STABLECOINS.map((coin, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'eth_call',
      params: [{ to: coin.address, data: '0x18160ddd' }, 'latest'],
    })),
  ];
}

async function loadEthereum(): Promise<NonNullable<Onchain['ethereum']['data']>> {
  const replies = await getJson(
    ETHEREUM_RPC,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ethereumBatch()),
    },
    'PublicNode',
  );
  if (!Array.isArray(replies)) throw new Error('PublicNode sent an unexpected reply');
  const result = (id: number): unknown =>
    (
      replies.find((reply) => (reply as { id?: unknown }).id === id) as
        { result?: unknown } | undefined
    )?.result;
  const gas = parseFeeHistory(result(0));
  if (!gas) throw new Error('PublicNode sent fee history in an unexpected shape');
  const supply = STABLECOINS.flatMap((coin, index) => {
    const value = parseSupply(result(index + 1), coin.decimals);
    return value === null ? [] : [{ symbol: coin.symbol, supply: value }];
  });
  return { gas, supply };
}

async function loadFearGreed(): Promise<FearGreed> {
  const parsed = parseFearGreed(await getJson(FEAR_GREED_URL, undefined, 'alternative.me'));
  if (!parsed) throw new Error('alternative.me sent the index in an unexpected shape');
  return parsed;
}

/** Poll one section while mounted; a failed refresh keeps what is shown and says why. */
function usePolled<K extends keyof Onchain>(
  set: (update: (current: Onchain) => Onchain) => void,
  key: K,
  load: () => Promise<NonNullable<Onchain[K]['data']>>,
  source: string,
  everyMs: number,
  freshness: 'polled' | 'eod',
): void {
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const data = await load();
        if (cancelled) return;
        reportRestFreshness(
          source,
          freshness === 'eod' ? { kind: 'eod' } : { kind: 'polled', everyMs },
        );
        set((current) => ({ ...current, [key]: { data, failure: undefined } }));
      } catch (error) {
        if (cancelled) return;
        const failure = failureOf(error);
        reportRestFreshness(source, freshnessOfFailure(failure));
        set((current) => ({ ...current, [key]: { ...current[key], failure } }));
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), everyMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [set, key, load, source, everyMs, freshness]);
}

/** Every on-chain section, polled while a panel shows them. */
export function useOnchain(): Onchain {
  const [onchain, setOnchain] = useState<Onchain>(EMPTY);
  usePolled(setOnchain, 'bitcoin', loadBitcoin, MEMPOOL_SOURCE, BITCOIN_REFRESH_MS, 'polled');
  usePolled(setOnchain, 'ethereum', loadEthereum, ETHEREUM_SOURCE, ETHEREUM_REFRESH_MS, 'polled');
  usePolled(
    setOnchain,
    'fearGreed',
    loadFearGreed,
    FEAR_GREED_SOURCE,
    FEAR_GREED_REFRESH_MS,
    'eod',
  );
  return onchain;
}
