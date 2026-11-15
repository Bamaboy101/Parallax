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

Light mint is a deep teal-mint, `#007878`: **5.31:1** contrast on white (the initial `#0E9F75`
proposal gave only 3.37:1). It sits at OKLCH hue 195° against the light up green's 141°, a
colour difference (ΔE OK) of 12.7 that stays 12.0 under simulated deuteranopia. The earlier
`#007A58` measured only 7.4 against up green at the same lightness. Lightness cannot separate them
further because both must keep 4.5:1 on white. Mint is never a price-direction colour; price
changes also retain their numeric sign.

Tailwind's default palette and all shadow utilities are removed. Subtle metal gradients appear
only on the top bar and logo; panels remain flat.

The alternative palette is selected with `<html data-palette="blue-orange">` and composes with
either theme:

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
- Density: Comfortable by default; `<html data-density="dense">` tightens `--row-h`, `--pad` and
  type sizes.
- Motion stays under 200 ms (`--motion-pulse` 150 ms, `--motion-fast` 120 ms) and drops to 0 when
  the system asks for reduced motion.

## Primitives

- `Panel`: widget surface with a title and slots for the truth badge and header actions.
- `Badge`: the truth badge. `LIVE 140ms`, `DELAYED 15m`, `EOD` or `OFFLINE`, plus the source. Mint
  when live, amber when stale or delayed, grey when offline; alternative palettes use yellow/ochre warnings.
- `Cell`: a number in mono with tabular figures, optional sign, suffix and up/down tone. Missing
  values render as an em dash.
