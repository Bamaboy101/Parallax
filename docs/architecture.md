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
through the hub. See "Edge Worker" below.

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
  /** Optional company news, newest first. Only the hub calls this. */
  fetchNews?(symbol: SymbolRef, from: number, to: number): Promise<NewsItem[]>;
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

| Direction | Message         | Meaning                                                                                                             |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| app → hub | `subscribe`     | Reference-counted: N subscribers share one upstream subscription. `background: true` marks an off-screen subscriber |
| app → hub | `unsubscribe`   | Releases one reference (with the same `background` flag)                                                            |
| app → hub | `keys`          | Full replacement of the user's keys; changed keys restart sources                                                   |
| app → hub | `verify-key`    | Check a typed, unsaved key for one provider                                                                         |
| app → hub | `history`       | Request bars for a symbol, interval and time range                                                                  |
| app → hub | `news`          | Request company news for a symbol and time range                                                                    |
| hub → app | `events`        | One batch per frame                                                                                                 |
| hub → app | `status`        | Every source's `SourceStatus`, on change and once a second                                                          |
| hub → app | `history`       | The bars for a request                                                                                              |
| hub → app | `history-error` | The request could not be served; `failure` says `rate-limited` (with `retryAt`) or `no-source` when that is why     |
| hub → app | `news`          | The headlines, and the feed that supplied them                                                                      |
| hub → app | `news-error`    | No usable feed with news, or the request failed; same `failure` as `history-error`                                  |
| hub → app | `verify-result` | `accepted`, `rejected` (FeedAuthError) or `failed`, with a reason                                                   |

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
the last trade, quote or book event: exchange-to-browser delay), `stale`, `attempt`, `retryAt`,
`key` (the vault id it needs, or null) and `rateLimited` (the last failure was HTTP 429).
Some streams carry no exchange time (Binance best bid/ask and book); their events use
`ts = receivedAt`, so latency comes from trades. The delay is measured against the local clock,
so a clock running behind the exchange reads as 0 ms.

**Staleness.** A live source turns stale when it has sent nothing for longer than its
`staleAfterMs`. A source can limit this to its active hours with `isActive(now)`, so a closed
market never reads as stale. Thresholds are set per adapter registration:

| Source                 | Stale after                                        |
| ---------------------- | -------------------------------------------------- |
| Crypto feeds           | 5 s                                                |
| US stock feeds         | 30 s, during market hours only                     |
| REST data (edge, T15)  | 2 × its refresh interval, tracked by the app layer |
| Alpaca snapshot poller | 45 s (3 polls), during market hours only           |

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

// Perpetual futures (kind 'perp', id 'BTC-USDT-PERP'), added in T13b.
interface DerivEvent extends BaseEvent {
  channel: 'deriv';
  markPrice: number;
  fundingRate: number; // current interval, as a fraction: 0.0001 = 0.01%; positive: longs pay
  nextFundingTime: number; // when the current interval settles
  openInterest: number | null; // base coin
  openInterestUsd: number | null;
}

interface LiquidationEvent extends BaseEvent {
  channel: 'liquidation';
  side: 'long' | 'short'; // the liquidated position: 'long' is a forced sell
  price: number;
  size: number; // base coin
}
```

The `bar` channel always streams **1-minute** bars (`interval: '1m'`), because `subscribe` takes no
interval. Longer intervals are built from them, and from `fetchHistory`, in the chart (T9). A
bar event's `ts` is the bar's open time. `MarketChannel` (every channel but `deriv` and
`liquidation`) is what spot, FX and stock adapters serve; they ignore the perp channels.

**Perp feeds** (all public, no key; each converts to the event's units):

| Feed              | Funding and mark                    | Open interest           | Liquidations                                                |
| ----------------- | ----------------------------------- | ----------------------- | ----------------------------------------------------------- |
| `bybit`           | `tickers.<PAIR>` (snapshot + delta) | same ticker (coin, USD) | `allLiquidation.<PAIR>`, every one; `Buy` = long liquidated |
| `okx` (port 443)  | `funding-rate`, `mark-price`        | REST every 30 s         | `liquidation-orders` (all swaps), contracts × `ctVal`       |
| `binance-futures` | `/market` `<pair>@markPrice@1s`     | REST every 30 s, × mark | `!forceOrder@arr`: largest per symbol per second            |

Binance moved futures streams to routed paths in 2026; the old `/stream` path sends nothing.
Bybit and OKX echo the page's origin for CORS, Binance answers `*`. Exchanges can refuse some
countries (Binance's futures API is documented to answer US addresses with 451); if every perp
feed fails, the board reads offline.

## History

`fetchHistory(symbol, interval, from, to)` is called by the hub only. The hub writes the bars to
the store. Widgets ask the store for history and never call `fetchHistory`.

## News

The News widget (`store/news.ts`) merges two sources, newest first, one entry per link or
headline:

- Publisher RSS from the edge (`/news?q=`), for everyone, no key.
- Company news through the hub (`fetchNews`), only for a catalogue stock and only when a feed
  with news is usable, i.e. the user has saved a Finnhub key. It goes from the browser to
  Finnhub on the user's own key, never through the edge: Finnhub's free licence is personal.

A query that is a catalogue ticker searches RSS by company name ("aapl" → "Apple"), because
headlines rarely carry tickers. `NewsItem` is `{ title, url, source, published, summary }`.

## FX and REST badges

The FX board (T13c) has two sections, each with its own truth badge: Kraken's 12 live pairs
(mid of best bid and ask, through the hub) and the ECB's euro reference rates for 29 currencies,
restated per US dollar (`store/ecb.ts`). The ECB rates come from Frankfurter v1
(`api.frankfurter.dev/v1/<start>..?base=USD`, keyless, `Access-Control-Allow-Origin: *`), fixed
once per working day around 16:00 CET and refreshed hourly; a currency's change compares the
latest fixing with the one before (positive: it strengthened against the dollar).

Sources outside the hub report their freshness to `store/panels.ts`
(`reportRestFreshness('ecb', { kind: 'eod' })`, or `freshnessOfFailure(failure)` when a fetch
fails). `useFreshness(sources)` gives one `Freshness` per source from the hub status or that
report; panel headers and in-panel badges both use it. A panel with several sources shows the
worst: offline, no key or key rejected, then rate limited, then stale, then EOD or delayed, then
polled or connecting, then the slowest live stream.

## Empty, no-key, rate-limited and offline states (T18)

Every panel says why it has nothing to show, from two models:

- **Live data**: `store/availability.ts` `availabilityOf(symbol, statuses, keys)` reads the
  router's order, each feed's `SourceStatus` and the key vault: `live`, `connecting`, `no-key`
  (every feed needs a key; names them), `key-rejected`, `capped` (the free stream is full),
  `rate-limited`, `offline` (with the soonest retry) or `unsupported`. A feed parked on a symbol
  without a key does not count as serving it. Rows show a short reason in place of a missing
  price (`widgets/RowReason.tsx`: Needs key, Cap full, Rate limited, Offline); a list whose rows
  all share one reason shows it once (`useSharedAvailability`); single-symbol panels (book,
  tape, chart) use `widgets/SymbolNotice.tsx`. US stocks have no free order book, and the book
  says so.
- **REST data**: stores keep a classified `Failure` (`store/failure.ts`: `rate-limited` with
  `retryAt`, `offline`, `no-source`, `unconfigured`, `error`) instead of a message, and keep the
  last good data on a failed refresh (news, FRED, calendar, ECB). The edge passes an upstream 429
  through with its `Retry-After` (exposed to the page by CORS) and never caches it.

`design/notices.ts` turns either into one sentence on what is missing and one on what happens
next, and `design/PanelNotice.tsx` shows it with an "Open Settings" button when a key would fix
it (a window event the shell answers, so widgets never import the shell). Truth badges gained
`CONNECTING`, `NO KEY`, `KEY REJECTED` and `RATE LIMITED`; the top bar shows "No network" while
the browser is offline and names any provider that is rate limiting.

**Rate limits.** `getJson` turns a 429 into `HttpError` with the provider's `Retry-After`. The
hub marks the source `rateLimited` and waits at least that long (60 s when none was given) before
reconnecting; the next message clears it. History and news requests that hit a limit return
`failure: { reason: 'rate-limited', retryAt }`.

**Performance (T18).** Measured on the production build in headless Chromium at 1440×900, Mission
Control plus a 50-symbol watchlist (13 crypto, 12 FX, 25 US stocks), glass on, 20 s per run:

| Load                                      | Dark fps | Light fps | p95 frame |
| ----------------------------------------- | -------- | --------- | --------- |
| Live feeds (90–175 events/s)              | 59.4     | 59.7      | 16.8 ms   |
| Synthetic: every symbol 20 times a second | 58.3     | 59.3      | 16.8 ms   |

The synthetic run feeds about 1,000 events/s through the real store path (one batch per 50 ms,
as the hub posts). Script time stays small (under 10% of the profile); the rest is style, layout
and paint. Two changes bound that work per update, though the frame rate was already within a
frame of 60 before them: the pulse reads its tokens once (`design/pulse.ts`, refreshed on theme,
palette, inline-style or motion changes) instead of a computed-style read on every price change,
and a cell runs at most one wash at a time (a same-direction change lets the running wash
finish; a reversal replaces it). The development build is several times slower and is not a
measure.

## Movers and breadth

`store/movers.ts` (T13d) ranks every catalogue symbol the store has a price for at the moment
shown (now or the Rewind cursor), recomputed every 2 s. It only reads: nothing subscribes, so the
board covers what the other panels stream, and opening more boards widens it. Change uses the
same pure `priceLine()` as the watchlist (24 hours for crypto and FX, previous close for stocks),
from the shared history cache (`cachedHistory`); missing histories are loaded once and refreshed
every 15 minutes. Most active is dollars traded in the last hour the page has seen, from the
trade history (USDT counted as USD; stocks are IEX prints only). Breadth counts symbols up, down
and flat among those with a change.

## Prediction markets (M1)

`store/predictions/` reads Polymarket's public data (see data-sources.md). `classify.ts` is
pure and tested against recorded events: it drops sports, entertainment, crypto-price and
price-target bets and novelty markets, then files each event under one theme (central banks,
inflation/jobs/growth, elections and leaders, conflict and sanctions, trade/tariffs/oil,
shutdowns/debt/defaults) and one region, and links it to the assets it moves (the Fed to the US
2-year yield, gold and the dollar proxy UUP; the BoJ to USD/JPY and EWJ; Middle East flashpoints to
oil and gold). Only the Fed, ECB, BoE, BoJ, RBA and PBoC count as central banks; elections count
only in major economies. Outcomes read most likely first, except "by…?" date ladders, which read
in date order with passed rungs hidden.

`worker.ts` runs the Gamma tag queries off the main thread every 10 minutes; `store.ts` holds the
events in one Zustand store for every panel and the co-pilot, polls midpoints every 15 s
while a panel is mounted, and reports `polymarket` freshness (`POLLED 15s`). A failed refresh keeps
what is shown. The `predictions` widget ("Event odds", command `odds fed`) groups by theme and
region, shows each event's leading outcome, 24 h change in points and 24 h volume, and opens a
week of odds and every outcome on click. Odds are labelled "market odds, not forecasts"; they are
not part of Rewind, and the panel says so while rewound.

## Europe and Asia-Pacific boards (M9)

`widgets/regionBoards.ts` defines each board: the region's live Kraken pairs (EUR/USD, GBP/USD,
USD/CHF; USD/JPY, AUD/USD), its exchanges' sessions, and index rows. Nineteen indices show a
US-listed ETF proxy labelled "proxy, US hours only" with "official index level needs a licence";
TAIEX shows its official TWSE close (`store/taiex.ts`), with the licence's attribution in the
footnote. `regionOpenNotice` uses `store/sessions.ts` (the Session ring's model, which now also
holds Sydney, Hong Kong, Mumbai and Frankfurt): while any of the region's exchanges trades and
New York does not, the board says which are open, that the proxies hold their last US close, and
that the currency rows above are what moves. The Europe and Asia-Pacific workspaces put the same
pairs in a watchlist at the top left, the board below it, and a chart of the main pair, news,
event odds and the Session ring beside them.

## Paper trading (F4)

`store/paper/client.ts` is the only code that talks to Alpaca's trading API, and it can only reach
`https://paper-api.alpaca.markets`: `paperUrl` builds every request URL and throws
`PaperOnlyError` unless its origin is exactly that one, and a key that looks like a live-trading
key (Alpaca's live keys start with AK, paper keys with PK) is refused before any network call.
Lint (`no-restricted-syntax` in `eslint.config.js`) fails the build if Alpaca's live trading host
appears in any string or template literal under `apps/`, so a live path cannot be added quietly.

`store/paper/store.ts` keeps the account, positions and open orders in one store, polled every
5 s while a panel or ticket uses it (badge `POLLED 5s · alpaca-paper`), and sends orders
(`placePaperOrder`: whole shares, `day` orders, market or limit with tick-sized prices, built and
checked by `orderBody`) and cancels. The key is the user's Alpaca key from the vault (the same
paper key that streams US stocks). A stock or ETF chart has a "Paper trade" button that opens the
ticket (`widgets/PaperTicket.tsx`); it says when a day order will wait for New York's open. The
`paper` widget shows equity, today's profit and loss (equity minus last close's), buying power,
positions with unrealised profit and loss and a Close button (a market order the other way), and
open orders with Cancel. Every view says fake money and that live trading is not possible.

## Learn mode (F5)

One switch in the top bar (`app/LearnSwitch.tsx`, saved in `store/prefs.ts` with palette and
density, and marked as `data-learn="on"` on <html>) explains the terminal in plain words:

- **Every panel.** `WidgetMeta.learn` is required, so a widget cannot be added without its
  explanation. Each dock widget is rendered inside `LearnFrame` (`app/LearnStrip.tsx`, applied in
  `contained()`), which shows that text above the panel and what the panel's truth badges mean
  right now. The frame is always there, so switching never remounts a widget.
- **Every number and label.** `app/LearnLayer.tsx` explains what is under the pointer or focus:
  a column heading, a number (by the heading of its column, found through the row's shared
  `*-columns` grid class), a labelled figure, or an element marked `data-term`. The words live in
  one glossary (`design/learn.ts`, `GLOSSARY`); a test renders the boards and checks every column
  heading has an entry.
- **Every badge.** `badgeExplanation` says what each state means (live with its delay, polled,
  delayed, end of day, connecting, rate limited, no key, key rejected, offline).

## Co-pilot (F1)

The `copilot` widget (command `ask why is BTC down`; a question typed in the command bar is asked
once the panel is ready) answers plain-word questions from what is on screen:

- **Context.** `store/copilot/context.ts` turns every other panel in the dock into a citable item
  (`P1`, `P2`…) with its latest figures: prices and 24 h or since-close change for watchlists,
  charts, books, tapes and the boards (the widget passes each board's fixed rows), movers and
  breadth, perp funding and open interest, the paper account, and, when those panels are open,
  the Macro panel's FRED rows and the Calendar's next releases (fetched through the same cached
  edge requests the panels use, with the same calculations). With an Event odds panel open, the
  top eight events' odds are added (`O1`…, labelled market odds, not forecasts); up to twelve
  headlines from the edge `/news` route (about the first catalogue asset the question names) are
  `N1`…. Panels without figures (Session ring, Settings) are left out.
- **Keys.** `store/copilot/keys.ts` is its own vault (`open-terminal:ai-keys` in local storage),
  separate from the data keys because data keys are handed to the feed hub and AI keys never are.
  `store/copilot/providers.ts` builds every URL from the provider's own origin
  (`https://api.anthropic.com`, `https://api.openai.com`) and refuses any other, so a key reaches
  only its provider. Models come from the provider's own `GET /v1/models` with the user's key,
  which is also the key check; nothing is hard-coded to a model name.
- **Calls.** Anthropic: `POST /v1/messages`, `anthropic-version: 2026-10-21` (which rejects
  `temperature`, so none is sent) and `anthropic-dangerous-direct-browser-access: true`, the header
  Anthropic requires for browser calls. Anthropic organisations with zero data retention, the
  Compliance API or an Enterprise parent cannot call from a browser; that 401 is explained, not
  reported as a bad key. OpenAI: `POST /v1/responses` with `store: false`.
- **Citations.** The system prompt (`store/copilot/guard.ts`) has the model answer only from the
  context and cite ids in brackets. The panel draws them as chips, lists every cited panel, event
  and headline (with its link) under Sources, warns when an answer cites nothing, and shows all
  it was given under "What it saw".
- **No advice.** The prompt forbids buy, sell, hold, sizing, timing, targets and forecasts, and
  two checks in code back it: `asksForAdvice` answers such questions locally without calling the
  AI, and `givesAdvice` withholds an answer that recommends a trade anyway.

## Options (M2)

`store/options/client.ts` builds every request on Alpaca's market data host and refuses any other
(`dataUrl`), with the user's Alpaca key from the vault. `store/options/store.ts` (`useOptions`)
reads the spot (IEX last trade) and the expiries of the next three months from calls within 2%
of the spot, then polls the chosen expiry's chain within 20% of the spot every 30 s, reporting
`alpaca-options` freshness (`POLLED 30s`, `NO KEY`, `KEY REJECTED`). `parse.ts` holds the pure
parts: OCC symbols, snapshots, strike rows, the smile (out-of-the-money side only: puts below the
spot, calls at and above it) and the put/call ratio by contracts traded in the latest session.
The `options` widget (command `options AAPL`) shows the expiry picker, spot, at-the-money IV,
put/call ratio and volumes, the smile, and the chain with calls left, puts right, a spot divider
it opens centred on, and a muted tint on in-the-money halves. Each row is eleven direct cells so
learn mode explains every number by its column.

## Rates desk (M3)

`store/rates/store.ts` is one store for the desk and the co-pilot. While a desk is open it loads,
straight from the browser and hourly, the US Treasury's daily par yield curve CSV for this year
and last (`home.treasury.gov`, CORS `*`) and a year of SOFR and EFFR from the New York Fed's
Markets Data API (`markets.newyorkfed.org`, which allows our origin). Each source may fail alone;
what is shown stays, and `treasury` and `nyfed` report `EOD` freshness. `parse.ts` reads the CSV
(13 tenors, 1M to 30Y; empty cells stay missing, never zero), the reference rates, and the FOMC
target range's changes from the EFFR history (`targetPath`). The `rates` widget (commands
`rates`, `curve`, `yields`, `sofr`; the Macro panel keeps `macro` and `fred`) draws the curve now,
a month and a year ago, a tenor table with 1-day, 1-month and 1-year changes in basis points
(neutral, since yields are not price moves), the 2s10s and 3m10y spreads, SOFR with its
1st–99th percentile range and volume, EFFR with the target range, the target range over the year
as a band with EFFR inside, its recent moves, and the next three Fed decisions from Polymarket,
labelled market odds, not forecasts. The footnote carries the New York Fed's required notice.

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

**Rewind scrubber** (`app/RewindScrubber.tsx`, top bar): a range from the later of page open and
an hour ago, to now, in 5-second steps. The right end, or "Back to live", returns to live. The
chart, book, tape, watchlist, Constellation and market weather all follow the cursor.

**Sampling** (`store/sampling.ts`): `sampleAt` reads the last value at or before evenly spaced
moments by binary search in the ring buffers, so statistics never copy an hour of trades.
`priceGrid` uses the trade price, or the bid/ask mid for FX.

## Constellation and market weather

- **Constellation** (`store/constellation.ts`, `widgets/constellation/`): prices every 5 s over
  the last 15 minutes; each pair's correlation of 5-second log returns once 24 shared samples
  exist (about two minutes). Bodies are sized by traded value over the window (FX has no volume,
  so a fixed size) and coloured by their move. A force layout (`layout.ts`, deterministic)
  springs every pair to a rest length that shrinks as correlation rises: +1 touching, −1 far
  apart. It animates until settled; with reduced motion it settles at once and draws one frame.
  Pairs with |correlation| ≥ 0.5 are joined by a line, dashed when negative. A visually hidden
  list of buttons mirrors the canvas for keyboard and screen-reader users.
- **Market weather** (`store/weather.ts`, `app/weather.ts`): every 10 s, each watchlist symbol's
  last 5 minutes of 10-second return volatility over its hour's; the median ratio sets
  `data-weather` (calm < 0.8, steady < 1.25, active < 2, stormy) and `--weather` 0..1 on <html>,
  which tints the glow behind the panels. Nothing is set until there are 10 minutes of returns.

## Linked panels

Each panel with input (symbol, symbols or query) has a link dot in its header: click to cycle
no group → 1 → 2 → 3 → 4. The group lives in the panel's params (`link`), so it is saved with
the layout. Picking a symbol in a linked watchlist row or Constellation body calls
`selectLinked(group, id)` (`store/links.ts`); `useLinkFollower` (`app/links.ts`) then points every
panel in the group at it: symbol widgets show it, News searches for it (ticker for stocks, name
otherwise), list widgets keep their lists. Joining a group that already has a symbol adopts it.
Widgets never touch the dock; they only record the selection.

**Error containment.** Every dock widget renders inside `PanelBoundary`: a widget that throws
shows "‹Title› stopped working" with Try again, and the rest of the terminal keeps running.

## Routing and failover

`feeds/router.ts` gives each symbol an ordered list of feeds. The hub keeps the registered feeds
that support the symbol, in that order, and serves each subscription from the first usable one
(not `down`, not `auth-failed`, has its key) that has room under its symbol cap.

| Symbol                 | Order                                   |
| ---------------------- | --------------------------------------- |
| Crypto against USD     | Coinbase, Kraken                        |
| Crypto against USDT    | Binance, Kraken                         |
| FX (Kraken's 12 pairs) | Kraken                                  |
| US stocks              | Alpaca, Finnhub, Alpaca snapshot poller |
| USDT perpetuals        | Bybit, OKX, Binance futures             |

**Symbol caps.** A registration may set `symbolLimit` (Alpaca 30, Finnhub 50: their free stream
limits). The hub counts distinct symbols per feed across channels and never routes more. A symbol
past the cap goes to the next usable feed; with none, it waits with no feed. Each
`SourceStatus` carries `serving` (the symbol ids on that feed now), `symbolLimit` and `waiting`;
the top bar and Settings show a warning naming the waiting symbols. When a capped feed drops a
symbol, waiting or overflowed symbols move back to it.

**Visible first, poll the rest.** A subscription counts how many of its subscribers are on screen
(`subscribe` without `background`). Placement puts visible subscriptions first, then the rest in
subscription order, so on a full stream a symbol coming into view takes the slot of one that went
off screen, which moves to the next feed. For US stocks that is `alpaca-poll`
(`adapters/alpacaPoll.ts`): uncapped, it fetches one `/v2/stocks/snapshots` request for all its
tickers every 15 s (4 of Basic's 200 calls a minute, on the same queue as history), emitting the
latest IEX trade only when it is new, the latest quote and the last minute bar. Its registration
sets `key: 'alpaca'` (it uses the Alpaca key) and `pollMs`, so its truth badge reads
`POLLED 15s` (amber, like `DELAYED`) instead of a latency. Widgets mark rows with
`widgets/useVisibleRows.ts` (IntersectionObserver; rows in a hidden tab count as off screen) and
pass `background` through `useTick`, `useLastPrice` and `usePriceLine`. The client posts each
release a microtask late, so a re-subscription with a new flag lands first and the count never
touches zero. A row shows its current feed from `useServingSource(id)`, not its last tick, since a
quiet symbol's last print can predate a move.

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

| Typed           | Does                                                                                |
| --------------- | ----------------------------------------------------------------------------------- |
| `btc`           | Shows BTC/USD in the active panel (adds to a watchlist; else a chart)               |
| `btc chart 1h`  | Opens a 1-hour BTC/USD chart as a tab beside the active panel                       |
| `watch sol`     | Adds SOL/USD to the open watchlist                                                  |
| `news tesla`    | Opens News searching for "tesla"                                                    |
| `settings`      | Opens (or focuses) a widget that takes no input                                     |
| `world`         | World markets board (also `markets`, `sectors`, `bonds`, `commodities`)             |
| `funding`       | Crypto derivatives board (also `derivatives`, `perps`, `liquidations`, `oi`)        |
| `fx`            | FX board: Kraken live pairs and ECB daily rates (also `forex`, `currencies`, `ecb`) |
| `movers`        | Top gainers, losers, most active and breadth (also `gainers`, `losers`, `breadth`)  |
| `calendar`      | Upcoming US data releases (also `econ`, `releases`, `events`)                       |
| `layout crypto` | Replaces the panels with a workspace preset                                         |

Word order is free, and any alias in a widget's `meta.aliases` works as the widget word.

## Workspaces

- **Presets** are JSON files in `apps/web/src/workspaces/` (`mission-control`, `overview`,
  `crypto`, `equities`, `macro`): each lists panels with their widget, params (symbol, interval,
  query, list, link group), and position relative to an earlier panel; `inactive: true` adds a
  background tab. `buildWorkspace` lays one out; titles come from `panelTitle`. Adding a preset
  is one JSON file (plus its place in `ORDER`). Mission Control (`DEFAULT_WORKSPACE`) is the
  first-visit layout and the fallback when a saved layout no longer loads; a returning visitor's
  saved layout always wins.
- **Switcher**: the top-bar Workspace menu, or `layout <name>` in the command bar.
- **Files**: Download writes `{ app, kind: 'workspace', v: 1, dock, at? }` (`dock` is
  dockview's own layout JSON). Open accepts that or a bare dockview layout; a file that does not
  load leaves the current layout untouched.
- **Share links**: the same object, deflate-raw compressed and base64url-encoded, in the URL
  hash (`#w=…`), so it never reaches a server (about 0.7 KB for the Crypto desk). Opening one
  replaces the layout, then removes the hash so a reload shows the user's own layout. The link
  carries the sender's Rewind moment, but Rewind can only replay what the recipient's browser
  has seen since it opened (nothing is stored on a server). So a moment from before the page
  opened is reported and the panels stay live; it applies when it is within the page's history.

## Edge Worker

`apps/edge` is one Cloudflare Worker (`open-terminal-edge`, deployed by `deploy.yml` after CI).
Every route is a cached GET; a request needs an `Origin` on `ALLOWED_ORIGINS` (wrangler.toml
`[vars]`; `https://*.host` entries match subdomains, for Pages previews) or it gets 403.

| Route                     | Upstream                             | Edge cache | Notes                                        |
| ------------------------- | ------------------------------------ | ---------- | -------------------------------------------- |
| `/news?q=`                | 8 publisher RSS feeds (`NEWS_FEEDS`) | 2 min      | Fetched once per window, filtered per query  |
| `/fred?series=A,B&start=` | FRED `series/observations`           | 1 h        | Only the Macro board's series; ≤ 10 per call |
| `/sec?cik=`               | SEC `data.sec.gov/submissions`       | 10 min     | Latest 20 filings with document links        |
| `/calendar`               | FRED `releases/dates`                | 6 h        | Next 30 days, 11 major releases (T13e)       |

The calendar asks FRED with `include_release_dates_with_no_data=true` and a future
`realtime_end` (without them FRED lists only past dates), then keeps an allow-list of major
releases by FRED release id (`CALENDAR_RELEASES`: jobs 50, CPI 10, PPI 46, GDP 53, PCE 54,
retail sales 9, JOLTS 192, industrial production 13, housing starts 27, Michigan sentiment 91,
jobless claims 180). FRED has dates, not times: the board shows each agency's usual New York
time (`widgets/calendar/meta.ts`, labelled as usual) beside the viewer's local time. FOMC
meetings are not FRED releases and are not listed.

- No user key ever reaches the edge. The Worker holds two project secrets, set with
  `wrangler secret put`: `FRED_API_KEY`, and `SEC_USER_AGENT` (name and contact email, as SEC
  requires; kept out of the repo). Without one, its route answers 503 and says so.
- News is keyless publisher RSS only. Finnhub company news uses the user's own key from their
  browser (T15), because its free licence is personal and a shared cache would re-broadcast it.
- `/sec` takes a CIK, not a ticker: the SEC's ticker map is 800 KB and parsing it costs more
  than the free plan's 10 ms of CPU, so the app's catalogue carries each stock's CIK.
- Responses carry `X-Edge-Cache: HIT|MISS`. The Cache API works on the workers.dev address
  (measured: about 80 ms on a hit, against about 1.3 s for a cold `/news`).
- workerd, the local Worker runtime, does not start on macOS 12, so `wrangler dev` cannot run on
  the build machine; the Worker is covered by unit tests and checked against the deployed URL.
