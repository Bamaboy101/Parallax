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
- **M5 On-chain:** Bitcoin fees and blocks, Ethereum gas, stablecoin supply, DeFi totals, fear
  and greed. Source: mempool.space, DeFiLlama, alternative.me, a public Ethereum endpoint
  (confirm).
- **M6 DEX pairs:** prices and liquidity of trending on-chain pairs. Source: GeckoTerminal or
  DexScreener public APIs (confirm).
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
- **F7 Smart alerts** in plain words, delivered as browser notifications.
- **F8 Whale radar:** large trades and liquidations as a quiet signal on the Constellation and
  tape.
- **F9 Multi-screen:** pop panels out to a second monitor, still linked.
- **F10 Session recorder:** record, replay, export as a file.
- **F11 Installable app** with an offline shell.
- **F12 Sound layer**, off by default.

## Batches

| Batch | Contents                | Note                     |
| ----- | ----------------------- | ------------------------ |
| A     | M1, F4, F5, F1          | Build now, in that order |
| B     | M2, M3, F2, F7, F9      |                          |
| C     | F3, F8, M5, M6, F6, F12 |                          |
| D     | M4, M7, M8, F10, F11    |                          |

Each batch ends with one GPT visual pass.

## Hard rules for Batch A (17 Nov)

- **Paper trading** uses Alpaca's paper endpoint only. Live trading must be impossible in the
  code, not just hidden.
- **The co-pilot** uses the user's own AI key, stored in their browser like the data keys and
  sent only to that AI provider. It cites which panels and headlines its answer used, and never
  gives buy or sell advice: it explains, it doesn't recommend.
- **Prediction-market odds** are labelled as market odds, not forecasts.
- Every source marked (confirm) is checked against the provider's own docs first; the build
  stops if anything differs from this plan.
