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
- Earnings calendar (M7): `GET /api/v1/calendar/earnings?from=&to=[&symbol=]&token=` works on the
  free plan, CORS `*` (recorded 18 Nov 2026: 304 US companies from 18 Nov to 2 Dec,
  `{symbol, date, hour: bmo|amc|dmh|'', quarter, year, epsEstimate, epsActual, revenueEstimate,
revenueActual}`). Finnhub's terms (finnhub.io/terms-of-service, checked 18 Nov 2026) make every
  plan "strictly for personal use" and bar redistributing or sharing its data "with anyone or any
  3rd party": the panel fetches on the user's own key, shows it in the user's browser only, and the
  co-pilot passes it to the user's own AI provider only when the user asks it a question, as it
  already does for Finnhub stock prices.

## Alpaca paper trading (`store/paper/`)

Checked 17 Nov 2026 against Alpaca's docs (Paper Trading; Create an Order) and its OpenAPI spec.

- Paper accounts are free to anyone worldwide, start with $100,000 and have their own API keys,
  separate from live keys; the API is the same as live at `https://paper-api.alpaca.markets`.
  Live trading is on another host, which Parallax never calls (see architecture.md).
- The paper API allows browser calls (`Access-Control-Allow-Origin: *`, with the `APCA-API-KEY-ID`
  and `APCA-API-SECRET-KEY` headers allowed).
- Orders: `POST /v2/orders` with `symbol`, `qty`, `side`, `type` (`market` or `limit`),
  `time_in_force` (`day`) and `limit_price`; `DELETE /v2/orders/{id}` answers 204. A refused order
  answers 422 with `{ code, message }` (for example "qty must be > 0"), shown as is.
- Paper fills are simulated against live quotes: only marketable orders fill, partial fills come
  10% of the time, and slippage, market impact, fees and dividends are not simulated.
- Recorded 17 Nov 2026 with a paper key: account, positions, a limit and a market order (both
  cancelled at once; nothing filled) and a refused order, ids and account number replaced
  (`store/paper/fixtures/paper-account.json`).

## Alpaca options, indicative feed (`store/options/`)

Checked 17 Nov 2026 against Alpaca's docs (About Market Data API; Historical Option Data; Option
chain reference) and tested with a paper key from our origin.

- The free **Basic** plan includes options through the **Indicative Pricing Feed** only; the
  official OPRA feed needs the paid Algo Trader Plus plan. Alpaca: "Indicative Pricing Feed is a
  free derivative of the original OPRA feed: the quotes are not actual OPRA quotes, they're just
  indicative derivatives. The trades are also derivatives and they're delayed by 15 minutes."
  The panel says so in its caption and footnote, and every request asks for `feed=indicative`.
- `GET https://data.alpaca.markets/v1beta1/options/snapshots/{underlying}` returns, per OCC
  contract, the latest quote and trade, daily bar, `impliedVolatility` and `greeks`
  (Black-Scholes), filtered by `type`, `strike_price_gte/lte` and `expiration_date(_gte/_lte)`, up
  to 1000 per page with `next_page_token`. Same-day contracts come without IV or Greeks, so a
  panel opens on the first expiry after today. Paper keys work; the spot comes from
  `GET /v2/stocks/{symbol}/snapshot?feed=iex`.
- Browser calls are allowed (`Access-Control-Allow-Origin: *`, key headers allowed); the rate
  limit is 200 requests a minute. A panel reads the expiries every 30 minutes and its chain every
  30 s.
- Recorded 17 Nov 2026: 16 SPY contracts expiring 20 Nov, strikes 716–744
  (`store/options/fixtures/spy-chain.json`; market data only).

## US Treasury daily par yield curve (`store/rates/`)

Checked 17 Nov 2026 from the Treasury's interest-rate data pages and a browser call on our
origin.

- `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv`:
  one row per business day (`MM/DD/YYYY`), columns `1 Mo` to `30 Yr` (plus `1.5 Month`, recent
  only, not shown); empty cells where a tenor had no reading. No key; `Access-Control-Allow-Origin: *`.
- A work of the US government, not subject to copyright in the US (17 U.S.C. §105); the
  Treasury's site policies list no restriction on reuse. The footnote names the source.
- Recorded 17 Nov 2026: eight days of the 2026 file (`store/rates/fixtures/treasury-2026.csv`).

## New York Fed reference rates: SOFR and EFFR (`store/rates/`)

Checked 17 Nov 2026 against the Markets Data APIs documentation and the New York Fed's Terms of
Use (last updated 9 Jun 2023), and called from a browser on our origin.

- `GET https://markets.newyorkfed.org/api/rates/secured/sofr/search.json?startDate=…&endDate=…`
  and `…/unsecured/effr/…` return `refRates`: `effectiveDate`, `percentRate`, percentiles,
  `volumeInBillions`, and for EFFR `targetRateFrom`/`targetRateTo`. No key; the API allows our
  origin.
- Terms: a licence "to use, copy, and distribute Content for your personal or business purposes".
  Reference rates carry a Use Restriction: whoever presents the data "must include the following
  notice and disclaimer". The desk's footnote shows it: "The SOFR and EFFR are subject to the
  Terms of Use posted at newyorkfed.org. The New York Fed is not responsible for publication of
  the SOFR and EFFR by Parallax, does not sanction or endorse any particular republication,
  and has no liability for your use." The New York Fed's name is never used as an endorsement.
- Recorded 17 Nov 2026: EFFR samples since 27 Aug 2026 (including the 17 Sep target change) and
  the last three SOFR days (`store/rates/fixtures/`).

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

## Waiting for written permission

Four providers' terms bar a public app like this one from showing their data, or attach
obligations the project has not taken on. Each stays out until its permission arrives; nothing
else depends on them.

| Provider                  | Would unlock                                                              | Blocking terms                                             | Contact                                                                                         |
| ------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Kalshi                    | Kalshi odds beside Polymarket's in Event odds (M1)                        | Developer Agreement v1.1 §3, Data Terms of Use             | Kalshi support messenger at help.kalshi.com (logged in; no data-licensing address is published) |
| DefiLlama                 | DeFi totals and stablecoin supply across all chains in On-chain (M5)      | Terms of Use §7, §8.4, §8.7, §14                           | support@defillama.com (the address on defillama.com/terms)                                      |
| GeckoTerminal (CoinGecko) | Trending DEX pools with price, liquidity, volume and change: M6           | CoinGecko API Terms (5 Sept 2025) §4.3, §7.1, §11.3, §12.5 | support.coingecko.com/hc/en-us/requests/new (the API Terms' channel for queries)                |
| DEX Screener              | Pair lookups for M6, and trending pairs if it ever offers an organic list | API Terms & Conditions (18 Aug 2023) §1, §2                | DEX Screener, Inc., 113 SE 1st Ave #640, Miami, FL 33131 (the only contact its API terms give)  |

## Kalshi: not used (pending written permission)

Checked 17 Nov 2026. Kalshi's public REST market data needs no key, but its Developer Agreement
(v1.1, §3) allows API use only "to facilitate a member's own trading" and bars sharing the data,
and its Data Terms of Use bar publicly displaying or distributing Kalshi data and any use with AI
tools. Its WebSocket requires an API key even for public channels, its REST answers can lag by
several seconds, and it answers 403 to requests from our origin. It stays out until Kalshi gives
written permission.

## M6 DEX pairs: GeckoTerminal and DEX Screener not used (pending written permission)

Checked 17 Nov 2026 against each provider's own terms; both APIs are keyless and answer
`Access-Control-Allow-Origin: *` from our origin, so the block is legal, not technical. M6 is
skipped until one of them agrees in writing (decided 18 Nov).

- **GeckoTerminal** (`api.geckoterminal.com/api/v2/networks/trending_pools`) is the only free
  source of an organic trending list (ranked by engagement, activity and pool safety, not paid
  placement). Its keyless API is governed by the CoinGecko API Terms (5 Sept 2025), which require
  "Powered by CoinGecko" shown prominently (§4.3) and, for any product offered to others, "a binding
  user agreement and privacy policy" that names the API as CoinGecko's property, disclaims all its
  liability and makes the app responsible for data warnings (§7.1). The developer must also
  indemnify CoinGecko against claims from the app's users (§12.5) and give up any claim against it
  (§11.3). Parallax has no user agreement, and the project owner chose not to take on the
  indemnity. Written permission, or an agreement that drops §7.1 and §12.5 for a free open-source
  viewer, would unlock it. Its keyless rate limit is about 5 to 10 calls a minute per IP.
- **DEX Screener** (`api.dexscreener.com`) has no organic trending endpoint: its "boosts" and
  "token profiles" are paid promotions, and "trending metas" are categories ranked by a method it
  does not document. Its API Terms forbid "making the API Services, or any portion thereof,
  available for third parties" (§2), which reads on a public app showing the data, and any product
  whose "primary purpose is to compete directly with DEX Screener" (§1). No attribution is required,
  and its pair lookups allow 300 requests a minute. Written confirmation that displaying pair data
  in a free viewer is not "making the API Services available for third parties" would unlock pair
  lookups.

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

## On-chain (M5): mempool.space, PublicNode, alternative.me (`store/onchain/`)

Checked 17 Nov 2026 against each provider's own terms, and called from our origin (all answer
`Access-Control-Allow-Origin: *`, keyless). All three are read straight from the visitor's browser;
the edge Worker is not involved.

- **mempool.space** (`/api/v1/fees/recommended`, `/api/mempool`, `/api/v1/blocks`, every 30 s).
  Terms of Service (updated 10 July 2024) cover "their associated API services" and contain only
  no-warranty, no-liability, no-advertising and accelerator clauses: nothing restricts display,
  caching or commercial use, and no attribution is asked. No published rate limit (HTTP 429 when
  exceeded). The panel names the source anyway.
- **PublicNode** (`https://ethereum-rpc.publicnode.com`, one JSON-RPC batch every 15 s:
  `eth_feeHistory` over 5 blocks at the 25th/50th/75th tip percentiles, and `totalSupply()` of
  USDT, USDC and DAI). Terms (publicnode.com/terms): automated access "for development and
  production purposes … No prior authorization from us is required", and blockchain data "You may
  use it in your own applications and services, including displaying it to your users, but you
  may not resell access to the Endpoints or such data as a standalone product". Ruled out:
  cloudflare-eth.com (Cloudflare is deprecating the legacy hostname), eth.llamarpc.com (HTTP 525,
  no CORS header) and rpc.ankr.com/eth (Ethereum moved to Ankr's sign-in plan).
- **alternative.me Crypto Fear & Greed Index** (`/fng/?limit=2`, every 30 minutes; the index is
  daily, so the badge says EOD). Rules on the index page: "You must properly acknowledge the source
  of the data and prominently reference it accordingly. Commercial use is allowed as long as the
  attribution is given right next to the display of the data", and nothing that "could be
  confused with our offering". The panel shows "Data from alternative.me", linked to the index
  page, in the same row as the reading, in our own neutral style. 60 requests a minute.
- **DefiLlama: not used (pending written permission).** The plan named DefiLlama for DeFi totals
  and stablecoin supply. Its FAQ calls the API "open … free to use", but its Terms of Use (effective
  24 June 2025) govern the "official public API(s)" and grant a licence "for personal,
  non-commercial purposes" (§7), forbid to "republish the data in any form without permission" and
  to "transfer or 'mirror' the materials on another server" (§8.7, §8.4), with liquidated damages
  of up to USD 100,000 per violation (§14). A public app showing the data is republishing it. So
  DeFi totals are left out and stablecoin supply is read from the token contracts on Ethereum
  instead, labelled "on Ethereum; supply on other chains is not counted". Written permission from
  DefiLlama (contact on defillama.com/terms) would unlock both.

## Natural Earth land outlines (`widgets/globe/`)

Checked 17 Nov 2026 against naturalearthdata.com/about/terms-of-use: "All versions of Natural Earth
raster + vector map data found on this website are in the public domain", "No permission is
needed", and crediting is optional; the globe uses their suggested short credit, "Made with
Natural Earth." The 1:110m land layer comes packaged as TopoJSON by world-atlas (ISC), bundled
with the app, so no request is made for it. The globe's moves are the region boards' ETF proxies
and carry the same "proxy, US hours only" label. The Global macro map (M8) uses the same project's
1:110m countries layer (`world-atlas/countries-110m.json`) under the same terms and credit. Its
ids are ISO 3166 numeric codes; `store/worldIso.ts` holds their alpha-3 codes, a table of codes
generated once from the ISO 3166 list in pycountry (not shipped). N. Cyprus, Somaliland and Kosovo
have no numeric code in the layer and are drawn without data.

## Speech recognition for voice commands (F6)

Not a data source, but a place a user's audio can go, so it was checked like one (MDN, 18 Nov
2026). "On some browsers, speech recognition uses a server-based recognition engine by default.
Your audio is sent to a web service for recognition processing"; setting `processLocally` makes
recognition happen on the device, after `SpeechRecognition.available()` reports the language
`available` (or `install()` downloads it), and "neither the audio nor the transcribed speech is
sent to a third-party service". The terminal therefore prefers on-device recognition, asks before
the one-time download, and uses a browser's online service only with the user's consent.
Parallax itself never receives audio or transcripts.

## The dollar and oil on the Rundown: FRED (`store/rundown.ts`)

The Rundown (E1) shows two daily series through the edge's existing FRED route, both labelled
"Public Domain: Citation Requested" on FRED (checked 18 Nov 2026):

- `DTWEXBGS`, Nominal Broad U.S. Dollar Index, Board of Governors of the Federal Reserve System
  (H.10 release), daily.
- `DCOILWTICO`, Crude Oil Prices: West Texas Intermediate (WTI) - Cushing, Oklahoma, U.S. Energy
  Information Administration (Spot Prices release), daily.

The page cites both sources and FRED, as FRED's terms ask for this label, and badges them EOD.
Gold on the Rundown is the PAX Gold token (PAXG/USD), a proxy, as elsewhere. World markets by
region show exchange hours, live currencies (Kraken) and TAIEX's official close without a key;
the US-listed country funds fill in with a stock key, labelled as funds trading in US hours.

## U.S. Energy Information Administration (EIA): the Energy panel (`store/energy.ts`)

Checked 18 Nov 2026 against eia.gov/about/copyrights_reuse.php: "U.S. government publications are
in the public domain and are not subject to copyright protection. You may use and/or distribute
any of our data"; EIA asks for an acknowledgment with the publication date, which the panel gives
("Source: U.S. Energy Information Administration (EIA)", each row with its week). The EIA logo and
name may not be used as a mark; the panel uses neither as one.

- API: `https://api.eia.gov/v2/seriesid/{id}` needs a free key (HTTP 403 without one, recorded);
  the project's key is a Worker secret (`EIA_API_KEY`). CORS is `*`, but the key stays on the
  edge. EIA's answer headers show a limit of 10 requests per window; the edge makes nine per
  hour at most, all cached together.
- Series: `PET.WCESTUS1.W` crude stocks excluding SPR, `PET.WGTSTUS1.W` gasoline,
  `PET.WDISTUS1.W` distillate, `PET.WCSSTUS1.W` SPR (thousand barrels), `NG.NW2_EPG0_SWO_R48_BCF.W`
  Lower 48 working gas (Bcf), `PET.WCRFPUS2.W` crude production (thousand barrels a day),
  `PET.WPULEUS3.W` refinery utilisation (%), `PET.RWTC.D` WTI Cushing spot ($/bbl),
  `NG.RNGWHHD.D` Henry Hub spot ($/MMBtu). Recorded 18 Nov 2026: latest week 2026-11-06, values
  as numbers, `period` as YYYY-MM-DD.
- Release days: petroleum Wednesdays and gas storage Thursdays, 10:30 New York time.
- No free source publishes analysts' forecasts for these reports, so "vs 5-yr" is a seasonal
  norm computed from EIA's own history, not a surprise against expectations.

## SEC EDGAR: insider trades and large holders (`store/corporate.ts`, edge `/insiders`)

Checked 18 Nov 2026 against sec.gov/about/privacy-information, "Website Dissemination":
"Information presented on sec.gov is considered public information and may be copied or further
distributed by users of the web site without the SEC's permission", with SEC credited as the
source; the EDGAR name and logo are trademarks, used here only in text, as the policy allows.
Fair access: at most 10 requests a second and a declared user agent with a contact; the edge
sends `SEC_USER_AGENT` and fetches documents five at a time.

- `https://www.sec.gov/files/company_tickers.json`: ticker to CIK, cached a day at the edge.
- `https://data.sec.gov/submissions/CIK##########.json`: a company's recent filings. Form 4s and
  Schedules 13D/13G about the company are listed there (recorded for Apple: 212 Form 4s and 8
  13G filings in the latest 400), but so are those the company filed about others (recorded:
  NVIDIA's 13G holding 11.5% of CoreWeave). The edge keeps only documents whose `issuerCik` is
  the company, and leaves out non-XML 13D/13G filings whose accession number starts with the
  company's own CIK.
- Form 4: the raw `ownershipDocument` XML is the primary document without its `xslF345X0N/`
  folder (recorded: an Apple officer's 10b5-1 sale). Only non-derivative transactions are shown.
- Schedules 13D/13G: XML since December 2024 (`reportingPersonName`, `classPercent`; recorded:
  Vanguard, 7.48% of Apple); older ones are HTML or text and are linked, not read.
- 13F was the plan's source for large holders, but a 13F lists one fund's own holdings; finding
  every fund that holds a company would mean reading every fund's 13F. 13D and 13G are the
  filings made about the company by anyone holding more than 5%.

## IMF World Economic Outlook and World Bank GDP: Global macro (`store/world.ts`, edge `/world`)

- **IMF.** Checked 18 Nov 2026 against imf.org/en/About/copyright-and-terms, "Special Terms for
  Statistical Data": users "may download, extract, copy, create derivative works, publish,
  distribute, and use Data", including the World Economic Outlook database, with attribution
  ("Source: International Monetary Fund, Database Name, link"), without altering the data, and
  "reasonable efforts to communicate and promote compliance" by their own users; commercial reuse
  needs permission (Parallax is free) and "bulk download ... by automated technology" without
  permission is barred. The edge makes three indicator requests a day through the DataMapper API,
  cached, which is not a bulk download of the site; the panel credits the IMF and links its terms
  in the footnote. The IMF also bars training language models on its content; the co-pilot only
  passes the figures on screen to the user's own AI provider to answer a question, which is not
  training.
  API: `https://www.imf.org/external/datamapper/api/v1/{indicator}` returns every economy and
  year (1980–2031 recorded); `/countries` and `/indicators` give names and the edition ("World
  Economic Outlook (October 2026)"). No CORS header, so the edge fetches it. The figures for the
  current year are IMF estimates.
- **World Bank.** Checked 18 Nov 2026 against datacatalog.worldbank.org/public-licenses: datasets
  are CC BY 4.0 by default, which "allows users to copy, modify and distribute data in any format
  for any purpose, including commercial use", with credit and a note of changes. The panel credits
  "World Bank, World Development Indicators (NY.GDP.MKTP.CD), CC BY 4.0" and says the figures are
  rounded. API: `https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&mrnev=1`
  (CORS `*`; recorded: US $30.77 trillion for 2025), fetched by the edge with the IMF data so the
  panel makes one request. The World Bank's site terms bar implying its endorsement; the panel
  only credits it.

## US market hours

Equity feeds turn stale after 30 s without a message, counted only during the regular session
(Mon–Fri 09:30–16:00 New York time; exchange holidays are not modelled). Outside it, the watchlist
and ticker rail show the last hourly close and the change since the previous session's close.
