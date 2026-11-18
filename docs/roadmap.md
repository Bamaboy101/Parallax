# v0.2 roadmap: more markets, more future

Added 17 Nov 2026 from the project plan. It replaces nothing: every v0.1 rule still holds (truth
badges, keys only in the browser and only to their provider, widgets read the store, no drop
shadows, motion under 200 ms, visual passes by a separate model).

Audience: self-directed traders and learners. Every source is free; those marked (confirm) must
be checked against the provider's own docs before building.

## New markets

- **M1 Prediction markets:** live odds on Fed decisions, inflation prints, elections and world
  events, with odds charts. Source: Polymarket public market data. No key. **Kalshi: pending
  written permission.** Checked 17 Nov 2026: Kalshi's Developer Agreement (v1.1, §3) limits API
  use to a member's own trading and bars sharing the data, its Data Terms of Use bar public
  display and any use with AI tools, its WebSocket needs an API key even for public channels, and
  its API refuses requests from our site's origin. It joins M1 only with Kalshi's written consent.
  Scope set 17 Nov: only market-moving events (the six central banks Fed, ECB, BoE, BoJ, RBA and
  PBoC; inflation, jobs, GDP and recession; elections and leadership in major economies; wars,
  conflicts and sanctions; tariffs, trade and OPEC/oil supply; shutdowns, debt limits and
  defaults), grouped by theme and region, each linked to the assets it moves, labelled "market
  odds, not forecasts".
- **M9 Europe, Asia and Australia** (added 17 Nov, right after M1): delayed or end-of-day levels
  for DAX, FTSE 100, CAC 40, Euro Stoxx 50, IBEX 35, FTSE MIB, SMI, AEX, Nikkei 225, TOPIX, Hang
  Seng, Shanghai Composite, CSI 300, KOSPI, TAIEX, Sensex, Nifty 50, STI, ASX 200 and NZX 50 from a
  free source whose terms allow display in a free public app (reported before building; no
  unofficial or scraped sources), always beside US-listed ETF proxies (EWG, EWU, EWQ, FEZ, EWP,
  EWI, EWL, EWN, VGK; EWJ, EWH, FXI, MCHI, EWY, EWT, INDA, EWS; EWA, ENZL) labelled "proxy, US
  hours only"; Sydney, Frankfurt, Hong Kong and Mumbai on the Session ring; Europe and
  Asia-Pacific workspaces.
  Built 17 Nov: the survey found one compliant free source, TWSE open data for TAIEX (official
  close); the other 19 show their ETF proxy with "official index level needs a licence". Each
  board and workspace leads with the region's live Kraken pairs (EUR/USD, GBP/USD, USD/CHF;
  USD/JPY, AUD/USD), and says so while the region trades and New York is closed. The licences that
  would unlock official levels are listed in data-sources.md.
- **M2 Options:** chain, implied-volatility smile, put/call ratio for US stocks and ETFs. Source:
  Alpaca indicative options feed (confirm on the free plan). User's Alpaca key.
  Confirmed and built 17 Nov: the free plan includes only the indicative feed (quotes adjusted
  from OPRA, trades 15 minutes late), labelled as such on the panel. Same-day expiries carry no
  IV, so the panel opens on the first later expiry.
- **M3 Rates desk:** full Treasury yield curve with history, SOFR, Fed funds path. Source: US
  Treasury daily yields, New York Fed API. No key.
  Built 17 Nov: both checked and called straight from the browser; the New York Fed's required
  reference-rate notice is on the desk. The plan names no source for the Fed funds path, so the
  desk shows the path so far (target range and EFFR from the New York Fed) and, beside it, the
  next decisions' Polymarket odds, labelled market odds, not forecasts.
- **M4 Energy:** oil and gas inventories, production, storage surprises. Source: EIA open data.
  Free project key.
  Built 18 Nov: an Energy panel from EIA's weekly reports (crude, gasoline, distillate and SPR
  stocks, Lower 48 gas storage, crude production, refinery utilisation) and the daily WTI and
  Henry Hub spot prices, through the edge on the project key. Differs from the plan: a "storage
  surprise" against analysts' forecasts needs consensus data no free source offers, so the panel
  compares each week's change with the same week of the previous five years, labelled a seasonal
  norm, not a forecast.
- **M5 On-chain:** Bitcoin fees and blocks, Ethereum gas, stablecoin supply, DeFi totals, fear
  and greed. Source: mempool.space, DeFiLlama, alternative.me, a public Ethereum endpoint
  (confirm).
  Built 17 Nov: Bitcoin fees, mempool and blocks (mempool.space), Ethereum gas and stablecoin
  supply on Ethereum (PublicNode JSON-RPC: USDT, USDC, DAI contracts), Fear & Greed with the
  required credit beside it (alternative.me). Differs from the plan: DefiLlama is not used, its
  terms bar republishing without permission (pending written permission), so DeFi totals are out
  and stablecoin supply covers Ethereum only.
- **M6 DEX pairs:** prices and liquidity of trending on-chain pairs. Source: GeckoTerminal or
  DexScreener public APIs (confirm).
  **Pending written permission (decided 18 Nov).** GeckoTerminal's keyless API falls under
  CoinGecko's API Terms, which require a user agreement and privacy policy for the app, an
  indemnity and a waiver of claims (§7.1, §11.3, §12.5); DEX Screener has no organic trending list
  and its terms bar making the API "available for third parties" (§2). Details and contacts in
  data-sources.md, "Waiting for written permission".
- **M7 Corporate events:** earnings calendar, insider trades, large-holder filings. Source:
  Finnhub earnings calendar (user's key), SEC EDGAR Form 4 and 13F.
- **M8 Global macro:** GDP, inflation, debt for 50 countries on a map. Source: World Bank and IMF
  open data.

## Futuristic features

- **F1 Co-pilot:** plain-word questions ("why is BTC down?", "brief me on today"), answered from
  on-screen data plus news, with sources. Runs on the user's own AI key, stored in their browser.
  Support Anthropic and OpenAI keys first.
  Built 17 Nov: a Co-pilot panel on the user's own Anthropic or OpenAI key (its own browser vault,
  never passed to the feed hub; each client can only reach its provider). Answers cite the panels,
  event odds and headlines they used; advice questions are refused before any call and answers
  that recommend a trade are withheld.
- **F2 Liquidity heatmap:** order book over time as a heat field behind price.
  Built 17 Nov: a "Liquidity" toggle on crypto and FX charts samples the whole book once a second
  (5 bp price bins) while on and shades resting size behind the candles, for the time the page
  has been recording (up to the Rewind hour).
- **F3 World globe:** 3D globe, day/night line, open markets lit, arcs for the biggest moves.
  Built 17 Nov: an orthographic globe with day, night and twilight from the sun's position, open
  exchanges lit from the session model, and arcs from New York to the three country ETFs (the
  region boards' proxies) that moved most since the previous close. Land: Natural Earth, public
  domain. It turns only when dragged; no idle spin, per the motion rules.
- **F4 Paper trading:** trade from the chart with fake money via Alpaca's free paper account:
  market and limit orders, open orders, positions, profit and loss, cancel.
  Built 17 Nov: paper endpoint only, enforced by the client (origin check, live keys never sent)
  and by lint (the live trading host cannot appear in source).
- **F5 Learn mode:** one switch overlays plain-language explanations on every panel, number and
  badge, for students and new traders.
  Built 17 Nov: a top-bar switch; a strip on every panel (each widget must carry its own
  explanation) with what its badge means, and plain-language meanings for every number, column,
  label and badge on hover or focus.
- **F6 Voice commands** via the browser's speech recognition.
  Built 18 Nov: a microphone in the command bar; on-device recognition where the browser has it
  (after a one-time model download it asks for), the browser's online service only after the user
  agrees. What is heard runs as a typed command would; voice cannot place orders.
- **F7 Smart alerts** in plain words, delivered as browser notifications.
  Built 17 Nov: price levels, moves within up to an hour and moves on the day, written in plain
  words and checked once a second against live prices; each fires once on a fresh crossing, with
  price, source and time. They run while a tab is open (no push server).
- **F8 Whale radar:** large trades and liquidations as a quiet signal on the Constellation and
  tape.
  Built 17 Nov: a whale is a trade over both $100,000 and its market's top 0.5% of the last hour,
  or a liquidation over $100,000 on the coin's perp. A dotted ring on the Constellation body, a
  marked row and a 15-minute summary line on the tape; neutral colours, no motion, replays under
  Rewind.
- **F9 Multi-screen:** pop panels out to a second monitor, still linked.
  Built 17 Nov: a window button on every panel group opens it in its own browser window (drag it
  to the other screen); it shares the page, so links, prices and theme follow, and it comes back
  with one click. Hover explanations stay in the main window.
- **F10 Session recorder:** record, replay, export as a file.
- **F11 Installable app** with an offline shell (moved to Batch E as E6).
- **F12 Sound layer**, off by default.
  Built 18 Nov: off until switched on in Settings; three short synthesised cues (an alert fires, a
  whale print on an open tape, the network goes away) with a volume and test buttons. Prices never
  make a sound by themselves.

## Rundown (Batch E, 18 Nov)

Goal: a first-time visitor with no finance background understands the markets in 10 seconds;
experts lose nothing. Built before Batch D.

- **E1 Rundown home:** the new first-visit screen. One calm page answering "what's happening in
  markets right now?": world markets by region, the five biggest moves, crypto, the dollar, oil
  and gold, the top three market-moving events with odds, today's calendar, the latest
  headlines. Plain words, big numbers, every figure keeps its badge. Fully useful with no keys
  at all. One button: "Open the full cockpit" (Mission Control).
  Built 18 Nov: the home page for first visits, switched with the cockpit in the top bar. Without
  a key: exchange hours, live currencies, TAIEX's official close, crypto, the Fed's broad dollar
  index and WTI oil (daily, FRED), gold through PAXG, Polymarket odds, FRED's release calendar
  and publisher headlines. Stock funds by region appear with a key.
- **E2 Simple and Pro modes:** Simple uses plain labels ("Bitcoin", not "BTC/USD perp
  funding"), hides jargon panels and turns Learn hints on. Pro is today's terminal. The choice is
  remembered.
  Built 18 Nov: a Simple / Pro switch in the top bar. Simple shows plain names in the watchlist,
  ticker rail, movers, chart, currency rows and odds chips, leaves seven traders' panels out of
  the command bar and presets, starts from its own layout and turns Learn hints on. First visits
  start in Simple; existing desks stay in Pro.
- **E3 Guided first visit:** a 4-step tour (Rundown, search, cockpit, keys), skippable, shown
  once.
  Built 18 Nov: Rundown, search, cockpit and keys, each ringed in mint with a short card; Skip,
  Back, Next, Done and Escape; remembered once seen.
- **E4 Daily brief without a key:** a rule-based written summary of the Rundown, generated from
  the store with no AI, every sentence traceable to a number on screen.
  Built 18 Nov: up to six sentences at the top of the Rundown, each with a link to the section
  whose numbers it quotes; tested for matching figures and for advice wording; checked live.
- **E5 Phone first:** Rundown and Simple mode work well at 390 px wide.
  Built 18 Nov: at 390 px the Rundown is one column with no sideways scroll; the top bar is three
  rows of 34–40 px controls (brand, Learn, Settings, theme; full-width search; Rundown / Cockpit
  and Simple / Pro); Simple's cockpit is one full-width group of tabs with its own saved layout.
  Checked in both themes; Pro on a phone is unchanged.
- **E6 Installable app:** F11, pulled forward from Batch D.
  Built 18 Nov: manifest and icons (the Parallax mark since the launch visual pass), an offline shell for
  the app's own files only, and Settings › App to install it. Chromium reports no installability
  errors; the shell reloads with the network off.

## Waiting for written permission

Sources whose terms keep them out of a public app until the provider agrees in writing. Contacts
and the exact clauses are in data-sources.md.

- **Kalshi** (M1): Kalshi odds beside Polymarket's.
- **DefiLlama** (M5): DeFi totals and stablecoin supply across all chains.
- **GeckoTerminal / CoinGecko** (M6): trending DEX pools.
- **DEX Screener** (M6): DEX pair lookups.

## Batches

| Batch | Contents                      | Note                     |
| ----- | ----------------------------- | ------------------------ |
| A     | M1, F4, F5, F1                | Build now, in that order |
| B     | M2, M3, F2, F7, F9            |                          |
| C     | F3, F8, M5, M6, F6, F12       |                          |
| E     | E1, E2, E3, E4, E5, E6 (=F11) | Before Batch D           |
| D     | M4, M7, M8, F10               |                          |

Each batch ends with one GPT visual pass. Batch C's is combined with Batch E's, at the end of
Batch E; it also covers the Parallax logo and the social preview card.

## Hard rules for Batch A (17 Nov)

- **Paper trading** uses Alpaca's paper endpoint only. Live trading must be impossible in the
  code, not just hidden.
- **The co-pilot** uses the user's own AI key, stored in their browser like the data keys and
  sent only to that AI provider. It cites which panels and headlines its answer used, and never
  gives buy or sell advice: it explains, it doesn't recommend.
- **Prediction-market odds** are labelled as market odds, not forecasts.
- Every source marked (confirm) is checked against the provider's own docs first; the build
  stops if anything differs from this plan.
