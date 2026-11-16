import type { AdapterContext, Channel, FeedAdapter, SymbolRef } from '../types';
import { field, isObject, obj, parseFrame, str } from './parse';
import { getJson, throttle } from './rest';
import { SocketAdapter, browserSocket, type SocketFactory } from './socket';

/**
 * USDⓈ-M futures market streams. Binance moved them to routed paths in 2026: mark price and
 * liquidations live under `/market` (the old `/stream` path no longer sends data).
 */
const URL = 'wss://fstream.binance.com/market/stream';
const REST = 'https://fapi.binance.com/fapi/v1';
/** Every liquidation on the exchange, at most one per symbol per second (the largest). */
const LIQUIDATIONS = '!forceOrder@arr';
/** Open interest has no stream; it is polled. */
export const BINANCE_OPEN_INTEREST_MS = 30_000;
/** Binance allows 10 control messages per second per connection. */
const CONTROL_GAP_MS = 250;
const restQueue = throttle(100);

const pairOf = (symbol: SymbolRef) => `${symbol.base}${symbol.quote}`;

interface Contract {
  symbol: SymbolRef;
  markPrice?: number;
  fundingRate?: number;
  nextFundingTime?: number;
  openInterest: number | null;
}

/**
 * Binance USDⓈ-M perpetuals: funding and mark price from `<pair>@markPrice@1s`, open interest by
 * REST every 30 s, and liquidations from the all-market force-order stream, filtered here. Binance
 * sends only the largest liquidation per symbol each second, so totals here undercount.
 */
export class BinanceFuturesAdapter extends SocketAdapter implements FeedAdapter {
  readonly id = 'binance-futures';
  readonly needsKey = false;
  protected readonly url = URL;

  /** Pair → state, for contracts whose `deriv` channel is wanted. */
  private readonly contracts = new Map<string, Contract>();
  /** Pair → symbol, for contracts whose liquidations are wanted. */
  private readonly liquidations = new Map<string, SymbolRef>();
  private sent = new Set<string>();
  private flushTimer: number | undefined;
  private interestTimer: ReturnType<typeof setInterval> | undefined;
  private requestId = 0;

  constructor(ctx: AdapterContext, createSocket: SocketFactory = browserSocket) {
    super(ctx, createSocket);
  }

  supports(symbol: SymbolRef): boolean {
    return symbol.kind === 'perp' && symbol.quote === 'USDT';
  }

  subscribe(symbol: SymbolRef, channel: Channel): void {
    const pair = pairOf(symbol);
    if (channel === 'deriv') {
      if (!this.contracts.has(pair)) this.contracts.set(pair, { symbol, openInterest: null });
      if (this.isOpen) void this.pollOpenInterest([pair]);
    } else if (channel === 'liquidation') {
      this.liquidations.set(pair, symbol);
    } else {
      return;
    }
    this.scheduleFlush();
  }

  unsubscribe(symbol: SymbolRef, channel: Channel): void {
    const pair = pairOf(symbol);
    const removed =
      channel === 'deriv'
        ? this.contracts.delete(pair)
        : channel === 'liquidation' && this.liquidations.delete(pair);
    if (removed) this.scheduleFlush();
  }

  override dispose(): void {
    globalThis.clearTimeout(this.flushTimer);
    globalThis.clearInterval(this.interestTimer);
    super.dispose();
  }

  protected onOpen(): void {
    this.sent = new Set();
    this.flush();
    void this.pollOpenInterest([...this.contracts.keys()]);
    globalThis.clearInterval(this.interestTimer);
    this.interestTimer = globalThis.setInterval(() => {
      void this.pollOpenInterest([...this.contracts.keys()]);
    }, BINANCE_OPEN_INTEREST_MS);
  }

  private wantedStreams(): Set<string> {
    const streams = new Set(
      [...this.contracts.keys()].map((pair) => `${pair.toLowerCase()}@markPrice@1s`),
    );
    if (this.liquidations.size > 0) streams.add(LIQUIDATIONS);
    return streams;
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
    const wanted = this.wantedStreams();
    const removing = [...this.sent].filter((name) => !wanted.has(name));
    const adding = [...wanted].filter((name) => !this.sent.has(name));
    if (removing.length > 0) {
      this.requestId += 1;
      this.send({ method: 'UNSUBSCRIBE', params: removing, id: this.requestId });
    }
    if (adding.length > 0) {
      this.requestId += 1;
      this.send({ method: 'SUBSCRIBE', params: adding, id: this.requestId });
    }
    this.sent = wanted;
  }

  private async pollOpenInterest(pairs: string[]): Promise<void> {
    for (const pair of pairs) {
      try {
        const body = await restQueue(() => getJson(`${REST}/openInterest?symbol=${pair}`));
        const contract = this.contracts.get(pair);
        if (!contract || this.disposed || !isObject(body)) continue;
        // USDⓈ-M open interest is counted in the base coin.
        contract.openInterest = field(body, 'openInterest');
        this.emitDeriv(pair, Date.now(), field(body, 'time'));
      } catch (error) {
        this.ctx.log('warn', `open interest for ${pair}: ${String(error)}`);
      }
    }
  }

  private emitDeriv(pair: string, receivedAt: number, ts: number): void {
    const contract = this.contracts.get(pair);
    if (!contract || contract.markPrice === undefined || contract.fundingRate === undefined) return;
    const { openInterest, markPrice } = contract;
    this.ctx.emit({
      symbol: contract.symbol.id,
      source: this.id,
      receivedAt,
      channel: 'deriv',
      ts,
      markPrice,
      fundingRate: contract.fundingRate,
      nextFundingTime: contract.nextFundingTime ?? 0,
      openInterest,
      openInterestUsd: openInterest === null ? null : openInterest * markPrice,
    });
  }

  protected onMessage(text: string, receivedAt: number): void {
    const frame = parseFrame(text);
    if ('code' in frame) {
      this.ctx.log('warn', `request rejected: ${String(frame.msg)}`);
      return;
    }
    if (!('stream' in frame)) return; // subscription acknowledgement
    const data = obj(frame, 'data');
    if (data.e === 'serverShutdown') {
      this.close();
      return;
    }
    if (data.e === 'markPriceUpdate') {
      const pair = str(data, 's');
      const contract = this.contracts.get(pair);
      if (!contract) return;
      contract.markPrice = field(data, 'p');
      contract.fundingRate = field(data, 'r');
      contract.nextFundingTime = field(data, 'T');
      this.emitDeriv(pair, receivedAt, field(data, 'E'));
      return;
    }
    if (data.e === 'forceOrder') {
      const order = obj(data, 'o');
      const symbol = this.liquidations.get(str(order, 's'));
      if (!symbol) return;
      this.ctx.emit({
        symbol: symbol.id,
        source: this.id,
        receivedAt,
        channel: 'liquidation',
        ts: field(order, 'T'),
        // The forced order's side: a forced sell closes a long.
        side: str(order, 'S') === 'SELL' ? 'long' : 'short',
        price: field(order, 'ap'),
        size: field(order, 'z'),
      });
    }
  }
}
