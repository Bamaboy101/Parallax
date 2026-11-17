# Design: chrome and mint

Calm, layered graphite and silver, with mint reserved for interface state. Both modes use
neutral greys without a blue cast. `apps/web/src/design/tokens.css` owns the palette; components
use the same semantic tokens in either mode.

## Colour

| Token     | Dark      | Light     | Used for                                                    |
| --------- | --------- | --------- | ----------------------------------------------------------- |
| `--bg`    | `#0D0D0D` | `#F0F0F0` | App background                                              |
| `--panel` | `#181818` | `#FFFFFF` | Widget surface                                              |
| `--line`  | `#383838` | `#D6D6D6` | Silver hairlines                                            |
| `--text`  | `#E8E8E8` | `#181818` | Primary text                                                |
| `--muted` | `#969696` | `#626262` | Secondary text                                              |
| `--live`  | `#6EF0C2` | `#007878` | Mint: live status, focus, active tabs, drag highlight, logo |
| `--up`    | `#39B54A` | `#237A12` | Rising price, saturated leaf green rather than mint         |
| `--down`  | `#FF6464` | `#B42332` | Falling price                                               |
| `--warn`  | `#F4BB4F` | `#8A5A00` | Delayed or stale data                                       |
| `--paper` | `#A6D6EE` | `#1E3946` | Simulated money: PAPER labels and the paper ticket          |

`--paper` (approved 17 Nov) is ice blue in dark mode and slate in light mode. The first proposal,
neutral grey (`#B8B8B8` / `#464646`), sat only 3.0 ΔE OK from the sand link group in dark mode.
These values were searched in OKLCH, greens excluded, against every reserved colour of both
palettes (mint, up, down, warn, the four link groups, orchid, the blue-orange alternatives and the
greys). Nearest reserved colour, ΔE OK: dark 10.1 (text), 11.1 sky link, 10.9 sand link; light
12.4 (sky link). Under simulated deuteranopia and protanopia the nearest stays 6.6 dark and 9.5
light. Contrast on the panel: **11.4:1 dark / 12.2:1 light**. The dark palette is too crowded for
any colour to stay far from everything under colour-blind simulation, so PAPER never relies on
colour: the word `PAPER` in a double outline and the double rule on the ticket carry it. Feed
warnings keep `--warn`.

Light mint is a deep teal-mint, `#007878`: **5.31:1** contrast on white (the initial `#0E9F75`
proposal gave only 3.37:1). It sits at OKLCH hue 195° against the light up green's 141°, a
colour difference (ΔE OK) of 12.7 that stays 12.0 under simulated deuteranopia. The earlier
`#007A58` measured only 7.4 against up green at the same lightness. Lightness cannot separate them
further because both must keep 4.5:1 on white. Mint is never a price-direction colour; price
changes also retain their numeric sign.

### Link groups

Linked panels (T16) share a symbol by group. Four tokens mark the groups; they are interface
colours only, never price or status, and every dot also shows its group number, so colour is
never the only cue.

| Token      | Name   | Dark      | Light     | Contrast on panel (dark / light) | Nearest reserved colour, ΔE OK |
| ---------- | ------ | --------- | --------- | -------------------------------- | ------------------------------ |
| `--link-1` | violet | `#E1A0FE` | `#791A9A` | 9.0 / 8.7                        | muted 19.3 / alt up 17.6       |
| `--link-2` | sky    | `#1CC9FE` | `#165782` | 9.2 / 7.7                        | alt up 16.2 / mint 10.9        |
| `--link-3` | rose   | `#EB64C2` | `#A15494` | 6.0 / 5.0                        | down 13.9 / down 14.5          |
| `--link-4` | sand   | `#CBB5AA` | `#534714` | 9.1 / 9.2                        | muted 11.9 / muted 11.9        |

Each value was searched in OKLCH within its hue family to keep the largest colour difference
from mint, up, down and warn in both palettes and from the greys, with at least 4.5:1 on the
panel. Sand is held to low chroma so it never reads as the amber stale warning.

Tailwind's default palette and all shadow utilities are removed. Subtle metal gradients appear
only on the top bar and logo.

Two tokens were added in V3 (approved 16 Nov):

| Token             | Dark                     | Light                    | Used for                                     |
| ----------------- | ------------------------ | ------------------------ | -------------------------------------------- |
| `--weather-warm`  | `#B79CED` (orchid)       | `#705294`                | Warm end of the market-weather glow          |
| `--glass-surface` | `--panel` at 88% opacity | `--panel` at 90% opacity | Frosted panel surface in Comfortable density |

Orchid means regime intensity only: it is neither a price direction (up, down) nor the amber that
marks stale data, so the glow cannot be read as either.

The alternative palette is selected with `<html data-palette="blue-orange">` and composes with
either theme. Settings › Display sets it, together with density; `store/prefs.ts` saves both under
`open-terminal:prefs` and applies them before the first render:

| Token    | Dark alternative | Light alternative |
| -------- | ---------------- | ----------------- |
| `--up`   | `#5B8CFF`        | `#295CC5`         |
| `--down` | `#FF8A3D`        | `#B34700`         |
| `--warn` | `#E8D44D`        | `#786800`         |

The warning is yellow (dark mode) or dark ochre (light mode), distinct from falling-price orange.
All three light alternatives exceed 4.5:1 contrast on white.

## Theme selection

The right-hand top-bar button shows a sun in dark mode and a moon in light mode, indicating the
destination. It is a native keyboard-operable button with an accessible label and mint focus ring.
On first visit, the inline head script in `apps/web/index.html` follows `prefers-color-scheme`.
It sets `data-theme` and the browser colour scheme before React or the stylesheet loads, and paints
the matching background to prevent a wrong-theme flash. Its two fallback background literals must
stay in sync with `--bg` above.

A click saves `dark` or `light` under `open-terminal:theme`. Storage reads and writes are guarded:
blocked storage still allows switching for the current visit. Invalid saved values fall back to the
system preference. Without a saved choice, each new page load follows the system.

## Type

Inter Variable for interface text, JetBrains Mono Variable for every number (`font-mono`), tabular
figures everywhere. Both are SIL Open Font License 1.1 and self-hosted through Fontsource.

## Shape, density, motion

- 4 px spacing grid: Tailwind's spacing unit is 4 px, so `p-2` is 8 px.
- 8 px panel radius (`rounded-panel`). No drop shadows; depth comes from surface colour.
- Panels are frosted glass in Comfortable density: one `backdrop-filter: blur(6px)` per dock
  group over `--glass-surface`, never stacked inside widgets. Dense density is solid, and so is
  the dock for the rest of the visit once more than 12 of 120 frames miss the 22 ms budget
  (`data-render="solid"`, measured in `DockArea`).
- The focused panel carries thin mint corner brackets; the app background has a faint 32 px
  grid in `--line`.
- Density: Comfortable by default; `<html data-density="dense">` tightens `--row-h`, `--pad` and
  type sizes.
- Motion stays under 200 ms (`--motion-pulse` 150 ms, `--motion-fast` 120 ms) and drops to 0 when
  the system asks for reduced motion. The one exception is the boot sequence: on the first load
  of a browser session, dock groups fade in one by one (160 ms each, staggered over 800 ms, under
  1 s in all). A click or key skips it; it never repeats in the session
  (`open-terminal:cockpit-boot` in session storage) and does not run under reduced motion.

## Primitives

- `Panel`: widget surface with a title and slots for the truth badge and header actions.
- `Badge`: the truth badge. `LIVE 140ms`, `DELAYED 15m`, `POLLED 15s`, `EOD`, `CONNECTING`,
  `RATE LIMITED`, `NO KEY`, `KEY REJECTED` or `OFFLINE`, plus the source. Mint when live; amber
  when stale, delayed, polled, rate limited or the key was rejected; grey when connecting, without
  a key or offline. Alternative palettes use yellow/ochre warnings. Each state also has its own
  static glyph before the label (V4), so states sharing a colour still differ at a glance: a dot
  when live or delayed, a dashed ring connecting, an open square without a key, a cross for a
  rejected key, two bars when rate limited, a flat line offline.
- `PanelNotice`: a panel's empty, no-key, rate-limited or offline state (T18): a title, one line
  on what happens next, and "Open Settings" when a key would fix it. It reads as part of the
  panel, not an error box (V4): hairlines above and below, no fill, and a small mark in place of a
  coloured rule: an open circle for setup or waiting (muted), an amber diamond for a limit or a
  rejected key, a flat grey line offline. No state uses mint or a price colour; the Settings button
  is a neutral outline. Rows show a short mono reason (`Needs key`, `Cap full`, `Offline`) with the
  same small mark where a price is missing. The World markets board, like the tape and the book,
  has no per-row pulse.
- Narrow screens (under 760 px) keep every panel at a readable width: the dock scrolls
  sideways, and the top bar says so ("Swipe across panels").
- `Cell`: a number in mono with tabular figures, optional sign, suffix and up/down tone. Missing
  values render as an em dash. With `pulse`, a change washes the cell in `--up` or `--down` at
  28% and fades over `--motion-pulse` (Web Animations API, so no React render; none under reduced
  motion).
- `Sparkline`: a small polyline of recent values in the up, down or muted tone.

## Widgets

- Truth badges sit in the dockview group header, right side, for the active panel. A panel fed by
  several feeds shows its worst feed (offline, then stale, then slowest) and a `+N` count; the
  tooltip lists all of them. The delay is exchange-to-browser, corrected for local clock skew.
- Lists (the trades tape) re-render at most 10 times a second; single cells update every frame.
- Learn mode (F5) adds a quiet strip above each panel (a 6% muted tint over the panel, label size)
  and a fixed tooltip for whatever is under the pointer or focus. Explainable labels get a dotted
  underline while it is on. The switch is mint when on (interface state). Nothing animates.
- A price from history rather than a live tick (an illiquid symbol before its first trade) is
  shown at 60% opacity with a tooltip saying so.
- Link dots sit before the truth badge: a numbered disc in `--link-1`…`--link-4`, or a dashed
  ring when the panel is unlinked. A linked watchlist row shows its selection with a 2 px mint
  bar.
- Rewind is a timeline: quarter ticks, a faint trace of the feed-store update batches the page
  has actually seen (per 5 s; nothing is inferred before the page opened), and a LIVE / PAST
  marker. In the past the marker, label, track and the Session ring's hand turn amber
  (`--warn`), the colour already used for data that is not live, with "Back to live" in mint.
- Market weather tints a glow behind the panels from mint (calm) toward orchid
  (`--weather-warm`, stormy), at 8–18% strength. It changes at most every 10 s and never animates.
- The command bar's microphone (F6) is a neutral outlined circle; while listening it turns mint
  (interface state) and the line under the query says "Listening on this device" or "…through
  the browser's speech service" with what has been heard. No pulse or animation.
- The liquidity heatmap (F2) shades resting order-book size behind the candles in `--text`, up
  to 55% opacity on a logarithmic scale, so it reads as neutral depth in both themes, never as a
  price direction. It updates once a second and never animates.
- The Session ring is a 24-hour dial on the viewer's clock: five-minute ticks, hour labels every
  3 h, one arc per market (Tokyo, London, New York, crypto always on), open arcs in mint
  (interface state, not price), closed ones in muted grey, and a hand at now.
- The Constellation draws a soft glow per body scaled by traded value, faint lines between pairs
  with |r| ≥ 0.65 (dashed when inverse), a mint ring on the selected body, and labels placed so
  they never overlap bodies or each other. Layout motion lasts at most 160 ms, then settles; under
  reduced motion it settles without animating. Whale activity (F8) is a dotted ring in the text
  colour around a body, and on the tape a 2 px text-colour bar and bold weight on the row, with a
  muted summary line that turns text colour (and gains a ◆) while there is any. Neutral, never up
  or down, and static: nothing flashes or pulses when a whale prints.
