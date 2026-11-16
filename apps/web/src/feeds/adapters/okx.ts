import type { AdapterContext, Channel, FeedAdapter, SymbolRef } from '../types';
import { field, isObject, list, num, obj, parseFrame, str, type Json } from './parse';
import { getJson, throttle } from './rest';
import { SocketAdapter, browserSocket, type SocketFactory } from './socket';

/** Public channels. OKX is retiring port 8443 and asks clients to use 443. */
const URL = 'wss://ws.okx.com:443/ws/v5/public';
const REST = 'https://www.okx.com/api/v5/public';
/** OKX drops a socket silent for 30 s; it expects a plain-text `ping`. */
const PING_MS = 20_000;
/** Open interest has no public channel; it is polled. */
export const OKX_OPEN_INTEREST_MS = 30_000;
const CONTROL_GAP_MS = 100;
/** Public REST allows 20 requests per 2 s per endpoint; keep bursts well under it. */
const restQueue = throttle(150);

const instIdOf = (symbol: SymbolRef) => `${symbol.base}-${symbol.quote}-SWAP`;

interface Swap {
  symbol: SymbolRef;
  fundingRate?: number;
  nextFundingTime?: number;
  markPrice?: number;
  openInterest: number | null;
  openInterestUsd: number | null;
}

/**
 * OKX USDT perpetual swaps: funding and mark price over the socket, open interest by REST every
 * 30 s, and liquidations from the all-swaps `liquidation-orders` channel, filtered here. Sizes
 * come in contracts and are converted to coins with each swap's contract value.
 */
export class OkxAdapter extends SocketAdapter implements FeedAdapter {
  readonly id = 'okx';
  readonly needsKey = false;
  protected readonly url = URL;

  /** instId → state, for swaps whose `deriv` channel is wanted. */
  private readonly swaps = new Map<string, Swap>();
  /** instId → symbol, for swaps whose liquidations are wanted. */
  private readonly liquidations = new Map<string, SymbolRef>();
  /** instId → coins per contract. */
  private readonly contractValue = new Map<string, number>();
  /** Subscription args the server has, keyed by their JSON. */
  private sent = new Map<string, Json>();
  private flushTimer: number | undefined;
  private interestTimer: ReturnType<typeof setInterval> | undefined;

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'perp' && symbol.quote === 'USDT';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    const instId = instIdOf(symbol);
    if (channel === 'deriv') {
      if (!this.swaps.has(instId)) {
        this.swaps.set(instId, { symbol, openInterest: null, openInterestUsd: null });
      }
      if (this.isOpen) void this.pollOpenInterest([instId]);
    } else if (channel === 'liquidation') {
      this.liquidations.set(instId, symbol);
      if (this.isOpen) void this.loadContractValue(instId);
    } else {
      return;
    }
    this.scheduleFlush();
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
    const instId = instIdOf(symbol);
    const removed =
      channel === 'deriv'
        ? this.swaps.delete(instId)
        : channel === 'liquidation' && this.liquidations.delete(instId);
    if (removed) this.scheduleFlush();
  }

  override dispose(): void {
    globalThis.clearTimeout(this.flushTimer);
    globalThis.clearInterval(this.interestTimer);
    super.dispose();
  }

  protected onOpen(): void {
    this.keepAlive(PING_MS, 'ping');
    this.sent = new Map();
    this.flush();
    for (const instId of this.liquidations.keys()) void this.loadContractValue(instId);
    void this.pollOpenInterest([...this.swaps.keys()]);
    globalThis.clearInterval(this.interestTimer);
    this.interestTimer = globalThis.setInterval(() => {
      void this.pollOpenInterest([...this.swaps.keys()]);
    }, OKX_OPEN_INTEREST_MS);
  }

  private wantedArgs(): Map<string, Json> {
    const args: Json[] = [];
    for (const instId of this.swaps.keys()) {
      args.push({ channel: 'funding-rate', instId }, { channel: 'mark-price', instId });
    }
    if (this.liquidations.size > 0) args.push({ channel: 'liquidation-orders', instType: 'SWAP' });
    return new Map(args.map((arg) => [JSON.stringify(arg), arg]));
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || !this.isOpen) return;
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, CONTROL_GAP_MS);
  }

  private flush(): void {
    if (!this.isOpen) return;
    const wanted = this.wantedArgs();
    const removing = [...this.sent].filter(([key]) => !wanted.has(key)).map(([, arg]) => arg);
    const adding = [...wanted].filter(([key]) => !this.sent.has(key)).map(([, arg]) => arg);
    if (removing.length > 0) this.send({ op: 'unsubscribe', args: removing });
    if (adding.length > 0) this.send({ op: 'subscribe', args: adding });
    this.sent = wanted;
  }

  private async loadContractValue(instId: string): Promise<void> {
    if (this.contractValue.has(instId)) return;
    try {
      const body = await restQueue(() =>
        getJson(`${REST}/instruments?instType=SWAP&instId=${encodeURIComponent(instId)}`),
      );
      const row = isObject(body) ? list(body, 'data')[0] : undefined;
      if (isObject(row)) this.contractValue.set(instId, field(row, 'ctVal'));
    } catch (error) {
      this.ctx.log('warn', `no contract value for ${instId}: ${String(error)}`);
    }
  }

  private async pollOpenInterest(instIds: string[]): Promise<void> {
    for (const instId of instIds) {
      try {
        const body = await restQueue(() =>
          getJson(`${REST}/open-interest?instType=SWAP&instId=${encodeURIComponent(instId)}`),
        );
        const row = isObject(body) ? list(body, 'data')[0] : undefined;
        const swap = this.swaps.get(instId);
        if (!isObject(row) || !swap || this.disposed) continue;
        // `oi` is in contracts, `oiCcy` in the coin, `oiUsd` in USD.
        swap.openInterest = field(row, 'oiCcy');
        swap.openInterestUsd = field(row, 'oiUsd');
        this.emitDeriv(instId, Date.now(), num(row.ts, 'ts'));
      } catch (error) {
        this.ctx.log('warn', `open interest for ${instId}: ${String(error)}`);
      }
    }
  }

  private emitDeriv(instId: string, receivedAt: number, ts: number): void {
    const swap = this.swaps.get(instId);
    if (!swap || swap.markPrice === undefined || swap.fundingRate === undefined) return;
    this.ctx.emit({
      symbol: swap.symbol.id,
      source: this.id,
      receivedAt,
      channel: 'deriv',
      ts,
      markPrice: swap.markPrice,
      fundingRate: swap.fundingRate,
      nextFundingTime: swap.nextFundingTime ?? 0,
      openInterest: swap.openInterest,
      openInterestUsd: swap.openInterestUsd,
    });
  }

  protected onMessage(text: string, receivedAt: number): void {
    if (text === 'pong') return;
    const frame = parseFrame(text);
    if ('event' in frame) {
      if (frame.event === 'error') this.ctx.log('warn', `request rejected: ${String(frame.msg)}`);
      return;
    }
    const channel = str(obj(frame, 'arg'), 'channel');
    for (const row of list(frame, 'data')) {
      if (!isObject(row)) continue;
      const instId = str(row, 'instId');
      if (channel === 'funding-rate' || channel === 'mark-price') {
        const swap = this.swaps.get(instId);
        if (!swap) continue;
        if (channel === 'funding-rate') {
          swap.fundingRate = field(row, 'fundingRate');
          // `fundingTime` is when the current interval settles; `nextFundingTime` the one after.
          swap.nextFundingTime = field(row, 'fundingTime');
        } else {
          swap.markPrice = field(row, 'markPx');
        }
        this.emitDeriv(instId, receivedAt, field(row, 'ts'));
      } else if (channel === 'liquidation-orders') {
        this.onLiquidations(instId, row, receivedAt);
      }
    }
  }

  private onLiquidations(instId: string, row: Json, receivedAt: number): void {
    const symbol = this.liquidations.get(instId);
    const perContract = this.contractValue.get(instId);
    if (!symbol || perContract === undefined) return;
    for (const detail of list(row, 'details')) {
      if (!isObject(detail)) continue;
      this.ctx.emit({
        symbol: symbol.id,
        source: this.id,
        receivedAt,
        channel: 'liquidation',
        ts: field(detail, 'ts'),
        // The forced order's side: a forced sell closes a long.
        side: str(detail, 'side') === 'sell' ? 'long' : 'short',
        price: field(detail, 'bkPx'),
        size: field(detail, 'sz') * perContract,
      });
    }
  }
}
