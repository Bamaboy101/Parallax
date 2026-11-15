# Architecture

This is the contract of record for how market data moves through Open Terminal. Code in
`apps/web/src/feeds/` must match it. If you change the contract, change this file in the same commit.

## Data flow

```
providers (WebSocket / REST)
        │
        ▼
FeedAdapter (one file per provider, runs inside the hub worker)
        │  ctx.emit(FeedEvent)
        ▼
feed hub  (apps/web/src/feeds/hub.worker.ts: one Web Worker owns every socket,
           routes symbols, batches events per frame, tracks status and age per source)
        │  postMessage(batch)
        ▼
store     (apps/web/src/store/: ticks, 60-minute ring buffers, history, time cursor)
        │  useTick(symbol, channel), history selectors
        ▼
widgets   (read from the store only)
```

Slow keyless public data (news, FRED, SEC) goes through the edge Worker in `apps/edge/`, not
through the hub.

## Rules

- A widget never opens a socket, calls `fetch` against a provider, or calls an adapter. It reads from
  the store. ESLint enforces this for `apps/web/src/widgets/`.
- API keys reach an adapter only through `ctx.getKey(provider)`. A key is never logged, never
  put in a URL that is logged, and never sent anywhere except the provider it belongs to.
- `feeds/` uses no `any`.

## Adapter context

The hub creates each adapter with a context object. This is the adapter's only link to the rest of
the app.

```ts
interface AdapterContext {
  /** Send one normalised event to the hub. */
  emit(event: FeedEvent): void;
  /** The user's key for a provider, or undefined if none is stored. */
  getKey(provider: string): string | undefined;
  /** Hub logger. Never pass a key or a keyed URL to it. */
  log: Logger;
}

type AdapterFactory = (ctx: AdapterContext) => FeedAdapter;
```

## FeedAdapter

```ts
type Channel = 'trade' | 'quote' | 'book' | 'bar';

interface FeedAdapter {
  id: string; // 'binance', 'alpaca', ...
  needsKey: boolean;
  supports(symbol: SymbolRef): boolean;
  subscribe(symbol: SymbolRef, channel: Channel): void;
  unsubscribe(symbol: SymbolRef, channel: string): void;
  /** Open the provider connection. The hub owns reconnect and backoff. */
  connect(): Promise<void>;
  /** Close sockets, clear timers, drop subscriptions. */
  dispose(): void;
  /** Optional REST history. Only the hub calls this; it writes the result to the store. */
  fetchHistory?(symbol: SymbolRef, interval: BarInterval, from: number, to: number): Promise<Bar[]>;
}
```

`SymbolRef` and `Logger` are defined in `feeds/types.ts` (T5).

## Normalised events

Events form a discriminated union on `channel`. Times are Unix epoch milliseconds.

```ts
interface BaseEvent {
  symbol: string;
  ts: number; // provider (exchange) timestamp
  receivedAt: number; // local time the hub received the message; truth badges use it for data age
  source: string; // adapter id
}

interface TradeEvent extends BaseEvent {
  channel: 'trade';
  price: number;
  size: number;
}

interface QuoteEvent extends BaseEvent {
  channel: 'quote';
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
}

type Level = [price: number, size: number];

interface BookEvent extends BaseEvent {
  channel: 'book';
  kind: 'snapshot' | 'delta'; // in a delta, size 0 removes the level
  bids: Level[];
  asks: Level[];
}

interface Bar {
  ts: number; // bar open time
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BarEvent extends BaseEvent, Bar {
  channel: 'bar';
  interval: BarInterval;
}

type FeedEvent = TradeEvent | QuoteEvent | BookEvent | BarEvent;
```

## History

`fetchHistory(symbol, interval, from, to)` is called by the hub only. The hub writes the bars to
the store. Widgets ask the store for history and never call `fetchHistory`.

## Routing

`feeds/router.ts` maps each symbol to an ordered list of adapters. If the first one is down or has
no key, the next takes over and the widget's truth badge shows the new source.

- USD crypto pairs (`BTC-USD`) go to Coinbase first. Binance serves USDT pairs only, and those
  are labelled USDT. A USDT price is never shown under a USD label.
- US stocks go to Alpaca, then Finnhub.
- FX pairs go to Kraken.
