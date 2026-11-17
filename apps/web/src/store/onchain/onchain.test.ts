import { describe, expect, it } from 'vitest';
import blocks from './fixtures/blocks.json';
import batch from './fixtures/ethereum-batch.json';
import fearGreed from './fixtures/fear-greed.json';
import fees from './fixtures/fees.json';
import mempool from './fixtures/mempool.json';
import {
  parseBitcoinFees,
  parseBlocks,
  parseFearGreed,
  parseFeeHistory,
  parseMempool,
  parseSupply,
  STABLECOINS,
} from './parse';
import { ETHEREUM_RPC, ethereumBatch, FEAR_GREED_URL, MEMPOOL_ORIGIN } from './store';

/** Recorded 17 Nov 2026 from mempool.space, PublicNode and alternative.me. */
describe('Bitcoin from mempool.space', () => {
  it('reads the recommended fees, the mempool and the latest blocks, newest first', () => {
    expect(parseBitcoinFees(fees)).toEqual({ fastest: 3, halfHour: 3, hour: 1, economy: 1 });
    expect(parseMempool(mempool)).toEqual({ count: 78_074, vMB: 34.090844 });
    expect(parseBlocks(blocks).map((block) => [block.height, block.txCount, block.pool])).toEqual([
      [976_310, 3020, 'Foundry USA'],
      [976_309, 3143, 'Foundry USA'],
      [976_308, 2191, 'F2Pool'],
    ]);
    expect(parseBlocks(blocks)[0]?.at).toBe(1_794_939_403_000);
  });

  it('refuses a fee reply missing a target', () => {
    expect(parseBitcoinFees({ fastestFee: 3 })).toBeNull();
  });
});

describe('Ethereum from PublicNode', () => {
  const result = (id: number) => batch.find((reply) => reply.id === id)?.result;

  it('turns fee history into the next base fee and median tips per speed, in gwei', () => {
    expect(parseFeeHistory(result(0))).toEqual({
      block: 26_436_546,
      baseFee: 0.172,
      tips: { slow: 0, standard: 0.015, fast: 0.6 },
    });
  });

  it('reads each stablecoin’s totalSupply with its own decimals, exactly past 2^53', () => {
    const supply = STABLECOINS.map((coin, index) => parseSupply(result(index + 1), coin.decimals));
    expect(supply[0]).toBeCloseTo(84_296_691_994.49, 1);
    expect(supply[1]).toBeCloseTo(44_512_308_193.51, 1);
    // DAI has 18 decimals: the raw value is far beyond Number's exact range.
    expect(supply[2]).toBeCloseTo(4_444_863_802.85, 1);
  });

  it('asks for fee history and every supply in one batch, on PublicNode only', () => {
    const requests = ethereumBatch() as { id: number; method: string }[];
    expect(requests.map((request) => request.method)).toEqual([
      'eth_feeHistory',
      'eth_call',
      'eth_call',
      'eth_call',
    ]);
    expect(new URL(ETHEREUM_RPC).origin).toBe('https://ethereum-rpc.publicnode.com');
    expect(new URL(MEMPOOL_ORIGIN).origin).toBe('https://mempool.space');
  });
});

describe('Fear & Greed from alternative.me', () => {
  it('reads the latest reading and the day before, numbers sent as strings', () => {
    expect(parseFearGreed(fearGreed)).toEqual({
      value: 12,
      label: 'Extreme Fear',
      date: 1_794_873_600_000,
      previous: { value: 10, label: 'Extreme Fear' },
    });
    expect(new URL(FEAR_GREED_URL).hostname).toBe('api.alternative.me');
  });
});
