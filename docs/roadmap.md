# v0.2 roadmap: more markets, more future

Added 17 Nov 2026 from the project plan. It replaces nothing: every v0.1 rule still holds (truth
badges, keys only in the browser and only to their provider, widgets read the store, no drop
shadows, motion under 200 ms, visual passes by a separate model).

Audience: self-directed traders and learners. Every source is free; those marked (confirm) must
be checked against the provider's own docs before building.

## New markets

- **M1 Prediction markets:** live odds on Fed decisions, inflation prints, elections and world
  events, with odds charts. Source: Polymarket and Kalshi public market data (confirm). No key.
- **M2 Options:** chain, implied-volatility smile, put/call ratio for US stocks and ETFs. Source:
  Alpaca indicative options feed (confirm on the free plan). User's Alpaca key.
- **M3 Rates desk:** full Treasury yield curve with history, SOFR, Fed funds path. Source: US
  Treasury daily yields, New York Fed API. No key.
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
- **F2 Liquidity heatmap:** order book over time as a heat field behind price.
- **F3 World globe:** 3D globe, day/night line, open markets lit, arcs for the biggest moves.
- **F4 Paper trading:** trade from the chart with fake money via Alpaca's free paper account:
  market and limit orders, open orders, positions, profit and loss, cancel.
- **F5 Learn mode:** one switch overlays plain-language explanations on every panel, number and
  badge, for students and new traders.
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
