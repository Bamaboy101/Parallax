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
  log: Logger; // (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
}

type AdapterFactory = (ctx: AdapterContext) => FeedAdapter;
```

## FeedAdapter

```ts
type Channel = 'trade' | 'quote' | 'book' | 'bar';

interface SymbolRef {
  id: string; // 'BTC-USD', 'ETH-USDT', 'AAPL', 'EUR-USD'; the key in events and the store
  kind: 'crypto' | 'equity' | 'fx';
  base: string; // 'BTC'
  quote: string; // 'USD', 'USDT': prices are always in this currency
}

interface FeedAdapter {
  id: string; // 'binance', 'alpaca', ...
  needsKey: boolean;
  supports(symbol: SymbolRef): boolean;
  /** May be called before connect(); the adapter applies it once its connection is open. */
  subscribe(symbol: SymbolRef, channel: Channel): void;
  unsubscribe(symbol: SymbolRef, channel: Channel): void;
  /** Run one connection: resolves when it closes, rejects when it fails. */
  connect(): Promise<void>;
  /** Close sockets and clear timers. connect() must settle soon after. */
  dispose(): void;
  /** Optional REST history. Only the hub calls this; it writes the result to the store. */
  fetchHistory?(symbol: SymbolRef, interval: BarInterval, from: number, to: number): Promise<Bar[]>;
}
```

### Connection lifecycle

An adapter instance runs **one** connection. The hub owns reconnect and backoff:

1. On the first subscription routed to a source, the hub calls `subscribe` and then `connect()`.
2. When `connect()` settles, for any reason, the hub disposes that instance, waits for the backoff
   delay, builds a fresh instance from the factory, replays every subscription and calls
   `connect()` again. Adapters therefore never re-subscribe or reconnect themselves.
3. Backoff is exponential with equal jitter: the ceiling starts at 500 ms, doubles per failed
   attempt and caps at 30 s; the wait is between half and all of the ceiling. The first event
   after a connect resets it.
4. Rejecting with `FeedAuthError` means the provider refused the key. The hub stops retrying and
   shows `auth-failed` until the user stores a different key.
5. A source that needs a key and has none shows `no-key` and is never connected.
6. When the last subscription on a source goes, the hub disposes it and the source returns to
   `idle`.

Callbacks from a disposed instance are ignored, so a late message can never overwrite fresh data.

## Hub protocol

The app talks to the worker only through these messages (`feeds/protocol.ts`).

| Direction | Message         | Meaning                                                           |
| --------- | --------------- | ----------------------------------------------------------------- |
| app → hub | `subscribe`     | Reference-counted: N subscribers share one upstream subscription  |
| app → hub | `unsubscribe`   | Releases one reference                                            |
| app → hub | `keys`          | Full replacement of the user's keys; changed keys restart sources |
| app → hub | `history`       | Request bars for a symbol, interval and time range                |
| hub → app | `events`        | One batch per frame                                               |
| hub → app | `status`        | Every source's `SourceStatus`, on change and once a second        |
| hub → app | `history`       | The bars for a request                                            |
| hub → app | `history-error` | The request could not be served                                   |

**Batching.** Events are posted once per display frame, with a 50 ms fallback so batches keep
flowing while the tab is hidden. Every trade and book update is kept, in order. Quotes keep only
the latest per symbol per frame, and bars only the latest per symbol, interval and bar open time.

**Status and age.** Each `SourceStatus` has `state` (`idle`, `connecting`, `live`,
`reconnecting`, `no-key`, `auth-failed`), `lastEventAt`, `latencyMs` (receivedAt − ts of the last
trade, quote or book event: exchange-to-browser delay), `stale`, `attempt` and `retryAt`.

**Staleness.** A live source turns stale when it has sent nothing for longer than its
`staleAfterMs`. A source can limit this to its active hours with `isActive(now)`, so a closed
market never reads as stale. Thresholds are set per adapter registration:

| Source                | Stale after                                        |
| --------------------- | -------------------------------------------------- |
| Crypto feeds          | 5 s                                                |
| US stock feeds        | 30 s, during market hours only                     |
| REST data (edge, T15) | 2 × its refresh interval, tracked by the app layer |

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
