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

## Alpaca Market Data, Basic plan (`feeds/adapters/alpaca.ts`)

Needs the user's free key: key ID and secret, stored joined as `KEY_ID:SECRET`.

- Stream: `wss://stream.data.alpaca.markets/v2/iex`. The free plan streams the IEX exchange only:
  prices track the full market closely on liquid names, volume is partial.
- Handshake: `[{"T":"success","msg":"connected"}]`, then `{"action":"auth",...}` →
  `authenticated`, then subscriptions. A bad key gets `{"T":"error","code":402}` (recorded); the
  adapter rejects with FeedAuthError. `406 connection limit exceeded` (another app or tab on the
  same key) is retried with backoff, not treated as a bad key.
- Channels used: `trades` (tape and live 1-minute bars, built from prints so the last bar moves
  with every trade) and `quotes`. Trade corrections and cancels are not applied. IEX has no order
  book, so the Order book widget has nothing to show for US stocks.
- Limits (Alpaca's plan table): **30 symbols** on the stream, one connection per endpoint, 200
  history calls a minute, history since 2016. The hub never routes more than 30 symbols to
  Alpaca: extra symbols go to Finnhub when its key is saved, otherwise they wait, and the top bar
  and Settings name them.
- History: `GET https://data.alpaca.markets/v2/stocks/{symbol}/bars` with `feed=iex`,
  `adjustment=split`, key in the `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY` headers (CORS allows
  them), paged by `next_page_token`. An empty range returns `"bars": null` (recorded).
- Key test: the always-on test stream `wss://stream.data.alpaca.markets/v2/test`; the key passes
  once a `FAKEPACA` message arrives (about every 5 s, recorded). It is a separate endpoint, so it
  does not take the live stream's one connection.
- Recorded 16 Nov 2026 with a free key, markets closed: the IEX handshake and subscription
  confirmation, the test stream's FAKEPACA quotes and trades, and one page of AAPL hourly bars.
  Real AAPL prints are confirmed after the 18:30 Dubai open (T20).

## Finnhub, free plan (`feeds/adapters/finnhub.ts`)

Needs the user's free key.

- Stream: `wss://ws.finnhub.io?token=…`; the token can only go in the URL, which is never logged.
  Messages: `{"type":"trade","data":[{"s","p","v","t"}]}` (recorded), plus `{"type":"ping"}`.
  Trades only; the adapter builds 1-minute bars from them.
- Limits (Finnhub pricing page): 60 REST calls a minute, plus 30 a second on every plan;
  **50 symbols** on the stream; one connection per key. Personal-use licence.
- Stock candles are a paid feature: a free key gets `403 You don't have access to this resource`
  (recorded). Finnhub therefore serves no history; Alpaca does.
- Company news: `GET /api/v1/company-news?symbol=&from=&to=` works on the free plan (recorded:
  87 AAPL items over 3 days, `{headline, url, source, datetime (s), summary}`). The adapter keeps
  the newest 50. It shares the 60-a-minute budget with key checks (one request a second).
- A refused token fails the WebSocket handshake with no readable reason (close code 1006, the
  same as a network failure). After a handshake that never opened, the adapter asks
  `GET /api/v1/quote?symbol=AAPL`: 401 means the key is refused. The token rides in that URL too,
  because Finnhub's CORS preflight does not allow its `X-Finnhub-Token` header from a browser.
- Recorded 16 Nov 2026 with a free key on `BINANCE:BTCUSDT`, which trades around the clock; stock
  trades use the same message format.

## Polymarket, public market data (`store/predictions/`)

Confirmed against Polymarket's docs on 17 Nov 2026 (docs.polymarket.com: API, Rate Limits,
Prices and Order Books, Get prices history) and tested from a browser on our origin.

- No key. Gamma (`gamma-api.polymarket.com/events`) and the CLOB's `/midpoints` and
  `/prices-history` answer with `Access-Control-Allow-Origin: *`, so each visitor's browser reads
  them directly; nothing is relayed or cached by the project.
- Limits are per IP and generous (Gamma `/events` 500 requests per 10 s, CLOB `/midpoints` 500 per
  10 s, `/prices-history` 1,000 per 10 s); a limited request is delayed rather than refused.
- Gamma pages above 50 events are served gzip-only, and Gamma has no field selection: an event
  carries every market's description. One refresh of the 16 tag queries is about 1 MB on the wire
  and 9 MB of JSON, so a dedicated worker fetches and curates it and posts only the result
  (`store/predictions/worker.ts`), every 10 minutes. Gamma's own cache is 5 minutes.
- Odds: `POST /midpoints` for the shown outcomes every 15 s (not cached). Following Polymarket's
  display rule, the last trade replaces the midpoint when the spread is over 10 cents. 24 h change
  starts from Gamma's `oneDayPriceChange`; volume is Gamma's `volume24hr`.
- History: `/prices-history?interval=1w&fidelity=60` (hourly points for a week, cached 90 s by
  Polymarket).
- Terms (polymarket.com Terms of Use, effective 11 Aug 2026): Polymarket bars "Capital Market
  Clients" (brokers, funds, banks, financial technology companies and the like) and market data
  distributors from accessing the data unless agreed in writing, and bars scraping the site. A
  free, open-source tool whose visitors' browsers read the documented public API, with no relay,
  falls outside those clauses on our reading (not legal advice). Polymarket also states its prices
  are not advice; the panel labels them "market odds, not forecasts".
- Recorded 17 Nov 2026: `store/predictions/fixtures/gamma-events.json`, 28 real events trimmed to
  the fields M1 reads.

## Kalshi: not used (pending written permission)

Checked 17 Nov 2026. Kalshi's public REST market data needs no key, but its Developer Agreement
(v1.1, §3) allows API use only "to facilitate a member's own trading" and bars sharing the data,
and its Data Terms of Use bar publicly displaying or distributing Kalshi data and any use with AI
tools. Its WebSocket requires an API key even for public channels, its REST answers can lag by
several seconds, and it answers 403 to requests from our origin. It stays out until Kalshi gives
written permission.

## Taiwan Stock Exchange open data: TAIEX (`store/taiex.ts`)

- The only free source of a non-US index level we found whose terms allow display in a public
  app (survey of 17 Nov 2026, below). Dataset "Weighted Stock Price Index Historical Data"
  (data.gov.tw dataset 11755), Securities and Futures Bureau, Financial Supervisory Commission,
  under the Open Government Data License, version 1.0: a "royalty-free copyright license to
  reproduce, distribute, publicly transmit… for any purpose", on condition of the attribution in
  its Exhibit, which the Asia-Pacific board prints word for word with a link to
  https://data.gov.tw/license. TWSE's own website terms exempt data it has authorised the open-data
  platform to publish.
- `https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=open_data` (keyless CSV, current
  month; `&date=YYYYMM01` for another month) answers with `Access-Control-Allow-Origin: *`, so the
  browser reads it directly, hourly. Dates are in the ROC calendar (year 115 = 2026). On a month's
  first trading day the previous close comes from last month's file. Badge: `EOD · twse`.

## Index levels: what a licence would unlock (M9)

Survey of 17 Nov 2026, each provider's own terms. No other free source allows public display of
the remaining 19 indices, so the Europe and Asia-Pacific boards show US-listed ETF proxies
("proxy, US hours only") with "official index level needs a licence":

| Index                       | Proxy         | Who licenses the level                  | Route to official levels                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nikkei 225                  | EWJ           | Nikkei Inc.                             | **Nikkei's "Closing Price Display" application** (indexes.nikkei.co.jp, display usage): "You may use the data with our permission and approval"; fee not published. FRED's `NIKKEI225` series also needs Nikkei's permission to redistribute.                                                                              |
| CAC 40, AEX                 | EWQ, EWN      | Euronext                                | **Euronext market data agreement (EMDDA)**: public display needs "prior written approval from Euronext for each Website"; delayed index redistribution is a paid licence (€423.10 for all indices in the 1 Apr 2026 fee schedule). Ask whether after-midnight (end-of-day) display for a free, open-source site is waived. |
| TOPIX                       | EWJ           | JPX                                     | Index licence for display to third parties.                                                                                                                                                                                                                                                                                |
| DAX, Euro Stoxx 50, SMI     | EWG, FEZ, EWL | STOXX / Deutsche Börse; SIX             | Data licence; site data is view-only.                                                                                                                                                                                                                                                                                      |
| FTSE 100, FTSE MIB, STI     | EWU, EWI, EWS | FTSE Russell (LSEG)                     | Data licence; website data is personal use only.                                                                                                                                                                                                                                                                           |
| IBEX 35                     | EWP           | BME (SIX)                               | Data licence.                                                                                                                                                                                                                                                                                                              |
| Hang Seng                   | EWH           | Hang Seng Indexes (via HKEX)            | Licence agreement with HSIL.                                                                                                                                                                                                                                                                                               |
| Shanghai Composite, CSI 300 | FXI, MCHI     | China Securities Index / SSE (via HKEX) | Licence.                                                                                                                                                                                                                                                                                                                   |
| KOSPI                       | EWY           | Korea Exchange                          | KRX Open API bars providing data to third parties; licence needed.                                                                                                                                                                                                                                                         |
| Sensex, Nifty 50            | INDA          | BSE / NSE Indices                       | Licence (terms pages unreadable without JavaScript; not confirmed).                                                                                                                                                                                                                                                        |
| ASX 200                     | EWA           | S&P Dow Jones Indices / ASX             | Licence.                                                                                                                                                                                                                                                                                                                   |
| NZX 50                      | ENZL          | NZX / S&P DJI                           | Paid distribution licence (end of day via S&P).                                                                                                                                                                                                                                                                            |

Free sources checked and ruled out by their own terms: Stooq (no redistribution), EODHD (no public
display, even free or non-profit), Financial Modeling Prep (no display on websites), Twelve Data
free (internal non-display, US only), Finnhub free (personal use, US only), Alpha Vantage (index
data is premium; personal use), Tiingo and Nasdaq Data Link (internal use), Massive/Polygon (no
coverage), data.go.kr and BoK ECOS for KOSPI (no third parties). When a licence arrives, its index
gets an official row like TAIEX's (`official` in `widgets/regionBoards.ts`) and keeps its proxy.

## US market hours

Equity feeds turn stale after 30 s without a message, counted only during the regular session
(Mon–Fri 09:30–16:00 New York time; exchange holidays are not modelled). Outside it, the watchlist
and ticker rail show the last hourly close and the change since the previous session's close.
