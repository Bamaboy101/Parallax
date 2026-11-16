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
  /**
   * The user's key for a provider, or undefined if none is stored. Two-part credentials arrive
   * joined by ':' (Alpaca: 'KEY_ID:SECRET'); the adapter splits them.
   */
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
  /**
   * Optional key check for Settings' "Test my key". Resolves when the provider accepts the key
   * from ctx.getKey; rejects with FeedAuthError when it refuses it, with any other error when the
   * check could not run. Only the hub calls this.
   */
  verifyKey?(): Promise<void>;
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
| app → hub | `verify-key`    | Check a typed, unsaved key for one provider                       |
| app → hub | `history`       | Request bars for a symbol, interval and time range                |
| hub → app | `events`        | One batch per frame                                               |
| hub → app | `status`        | Every source's `SourceStatus`, on change and once a second        |
| hub → app | `history`       | The bars for a request                                            |
| hub → app | `history-error` | The request could not be served                                   |
| hub → app | `verify-result` | `accepted`, `rejected` (FeedAuthError) or `failed`, with a reason |

**Key vault.** `store/keys.ts` keeps keys by provider id in `localStorage`
(`open-terminal:keys`), exactly as adapters receive them. Settings edits it; `store/feedClient.ts`
gives a newly started hub the stored keys and forwards every change. For
`verify-key` the hub builds a throwaway instance of that provider's adapter whose context returns
only the typed key, runs `verifyKey()` with a 15 s limit and disposes it. The live source keeps
its connection and stored key until the user saves.

**Batching.** Events are posted once per display frame, with a 50 ms fallback so batches keep
flowing while the tab is hidden. Every trade and book update is kept, in order. Quotes keep only
the latest per symbol per frame, and bars only the latest per symbol, interval and bar open time.

**Status and age.** Each `SourceStatus` has `state` (`idle`, `connecting`, `live`,
`reconnecting`, `no-key`, `auth-failed`, `down`), `lastEventAt`, `latencyMs` (receivedAt − ts of
the last trade, quote or book event: exchange-to-browser delay), `stale`, `attempt` and `retryAt`.
Some streams carry no exchange time (Binance best bid/ask and book); their events use
`ts = receivedAt`, so latency comes from trades. The delay is measured against the local clock,
so a clock running behind the exchange reads as 0 ms.

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
```

The `bar` channel always streams **1-minute** bars (`interval: '1m'`), because `subscribe` takes no
interval. Longer intervals are built from them, and from `fetchHistory`, in the chart (T9). A
bar event's `ts` is the bar's open time.

## History

`fetchHistory(symbol, interval, from, to)` is called by the hub only. The hub writes the bars to
the store. Widgets ask the store for history and never call `fetchHistory`.

## Tick store and Rewind

`store/feedClient.ts` starts the hub worker on first use and passes its batches to
`store/ticks.ts`, a Zustand store updated once per batch (so React renders at most once per
frame). Widgets use the hooks in `store/hooks.ts`:

| Hook                       | Returns                                                 |
| -------------------------- | ------------------------------------------------------- |
| `useTick(symbol, channel)` | The latest trade, quote, bar or book view at the cursor |
| `useTrades(symbol, limit)` | Recent trades at the cursor, newest first               |
| `useSourceStatus(source)`  | A feed's `SourceStatus`, for truth badges               |
| `useCursor()`              | The Rewind cursor (`null` = live) and its setter        |

Each hook holds a hub subscription while its component is mounted and re-renders only when its
own value changes. Books are rebuilt in the store from snapshots and deltas (at most 1000 levels
per side) and published as a top-50 `BookView`.

Every channel keeps 60 minutes of history per symbol, by local arrival time, in a ring buffer:

| Channel | Kept                          | Cap per symbol |
| ------- | ----------------------------- | -------------- |
| trade   | every trade                   | 100,000        |
| quote   | newest per 250 ms             | 15,000         |
| bar     | one entry per 1-minute bar    | 120            |
| book    | newest top-50 view per second | 3,700          |

The global cursor (`setCursor`) moves every hook to the same moment: each reads the newest value
at or before it. Live data keeps flowing into history while rewound.

## Routing and failover

`feeds/router.ts` gives each symbol an ordered list of feeds. The hub keeps the registered feeds
that support the symbol, in that order, and serves each subscription from the first usable one
(not `down`, not `auth-failed`, has its key) that has room under its symbol cap.

| Symbol                 | Order            |
| ---------------------- | ---------------- |
| Crypto against USD     | Coinbase, Kraken |
| Crypto against USDT    | Binance, Kraken  |
| FX (Kraken's 12 pairs) | Kraken           |
| US stocks              | Alpaca, Finnhub  |

**Symbol caps.** A registration may set `symbolLimit` (Alpaca 30, Finnhub 50: their free stream
limits). The hub counts distinct symbols per feed across channels and never routes more. A symbol
past the cap goes to the next usable feed; with none, it waits with no feed. Each
`SourceStatus` carries `symbols`, `symbolLimit` and `waiting`; the top bar and Settings show a
warning naming the waiting symbols. When a capped feed drops a symbol, waiting or overflowed
symbols move back to it.

USD pairs never route to Binance: Binance quotes USDT, and a USDT price is never shown under a USD
label. A USDT pair keeps its USDT label on every feed.

**Failover.** After 3 consecutive failed attempts, if every subscription on a feed has another
usable feed, the hub marks the feed `down` and moves its subscriptions to the next feed in their
order. The feed rests for 60 s, doubling on each repeat up to 30 min and resetting once it is live
again; then subscriptions move back and it is tried again. A key rejection moves subscriptions at
once. A feed with no alternative keeps retrying with backoff instead.

Only the feed currently serving a subscription reaches the store, so two feeds' prices never mix
in one series. The truth badge names that feed.

## Widgets and the command bar

A widget is a folder `apps/web/src/widgets/<id>/` with `meta.ts` (`meta: WidgetMeta`) and
`index.tsx` (default export: the dockview panel component). `app/widgets.ts` finds both by file
pattern, so adding a widget touches no shared file. `meta.input` tells the command bar what the
widget accepts and where it lives in panel params: `symbol` (`params.symbol`, plus
`params.interval` for charts), `symbols` (a list it adds to), `query` (free text) or `none`.

The command bar (`command/`) opens on `/` or Ctrl/Cmd+K. `parser.ts` turns text into ranked
suggestions; `search.ts` fuzzy-matches the instrument catalogue (`store/symbols.ts`);
`app/commands.ts` carries the chosen command out on the dock.

| Typed           | Does                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| `btc`           | Shows BTC/USD in the active panel (adds to a watchlist; else a chart)  |
| `btc chart 1h`  | Opens a 1-hour BTC/USD chart as a tab beside the active panel          |
| `watch sol`     | Adds SOL/USD to the open watchlist                                     |
| `news tesla`    | Opens news filtered to "tesla", once a widget registers `news` (T15)   |
| `layout <name>` | Replaces the panels with a preset (`default` now; four presets in T17) |

Word order is free, and any alias in a widget's `meta.aliases` works as the widget word.
