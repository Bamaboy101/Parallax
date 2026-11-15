# Data sources

Facts below were checked against each provider's own documentation, and message formats against
live recordings (`apps/web/src/feeds/adapters/fixtures/`), on 16 Nov 2026.

## Binance (`feeds/adapters/binance.ts`)

- Endpoint: `wss://data-stream.binance.vision/stream`, the market-data-only host, combined streams.
- Streams: `<pair>@trade`, `<pair>@bookTicker` (real time), `<pair>@depth20@100ms` (top-20
  snapshot every 100 ms), `<pair>@kline_1m` (updates every 2 s).
- Pairs: USDT only, labelled USDT.
- Limits: 5 incoming control messages per second per connection (the adapter batches
  subscriptions, one frame per 250 ms); 1024 streams per connection; 300 connection attempts per
  5 minutes per IP; a connection lives at most 24 h; the server pings every 20 s (browsers answer
  automatically). A `serverShutdown` event closes the connection early and the hub reconnects.
- Regions: Binance answers restricted locations with HTTP 451 ("Service unavailable from a
  restricted location", per its terms' Eligibility section). In a browser that shows up as a
  failed connection; the hub then fails over to Kraken.
- No timestamps on `bookTicker` or partial depth frames; those events use the receive time.

## Coinbase Exchange (`feeds/adapters/coinbase.ts`)

- Endpoint: `wss://ws-feed.exchange.coinbase.com`, keyless.
- Channels: `matches` (trades), `ticker` (best bid/ask on every match), `level2_batch` (full L2
  book: snapshot, then `l2update` changes batched every 50 ms).
- `level2` (unbatched) now requires authentication; `level2_batch` is the documented keyless
  equivalent.
- No candle channel: the adapter builds 1-minute bars from `matches`. The first bar after a
  connect starts at the first match it sees.
- `last_match` (the last trade before subscribing) is skipped.
- Limits: subscribe within 5 s of connecting or be disconnected; about 8 requests per second per
  IP (bursts to 20), 100 client messages per second; 10 subscriptions per product per channel.
  The adapter batches changes into one frame per 150 ms.
- Pairs: USD only.
- The `level2_batch` snapshot is the whole book (about 37,000 levels for BTC-USD when recorded).

## Kraken (`feeds/adapters/kraken.ts`)

- Endpoint: `wss://ws.kraken.com/v2`, keyless. Symbols use `BTC/USD` (not `XBT`).
- Channels: `trade`, `ticker` with `event_trigger: bbo` (quotes), `book` at depth 25, `ohlc` at
  1 minute (only the last bar of the snapshot is used).
- Book: the client must truncate to the subscribed depth; the adapter does, and emits dropped
  levels as size 0. The CRC32 checksum is not verified.
- Limits: the server closes a connection after about a minute without traffic (the adapter pings
  every 30 s); Cloudflare allows about 150 connection attempts per IP per 10 minutes before a
  10-minute ban, well above the hub's backoff.
- Pairs: crypto against USD and USDT, and these 12 spot FX pairs (confirmed from the public
  `AssetPairs` endpoint): AUD/JPY, AUD/USD, EUR/AUD, EUR/CAD, EUR/CHF, EUR/GBP, EUR/JPY, EUR/USD,
  GBP/USD, USD/CAD, USD/CHF, USD/JPY. These are exchange prices, not interbank rates.
