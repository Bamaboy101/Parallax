# Design: glass cockpit

Dark, calm, layered, and alive only where data moves. Every value below lives in
`apps/web/src/design/tokens.css`; components use Tailwind utilities mapped to those tokens and never
hard-code a colour.

## Colour

| Token     | Value     | Tailwind         | Used for                                |
| --------- | --------- | ---------------- | --------------------------------------- |
| `--bg`    | `#07090F` | `bg-bg`          | App background                          |
| `--panel` | `#0E121B` | `bg-panel`       | Widget surface                          |
| `--line`  | `#1C2331` | `border-line`    | Hairline borders, grid                  |
| `--text`  | `#E6EAF2` | `text-text`      | Primary text                            |
| `--muted` | `#7B8699` | `text-muted`     | Labels, secondary text                  |
| `--live`  | `#3DE0FF` | `text-live` etc. | Live status, focus ring, the one accent |
| `--up`    | `#3DDC97` | `text-up`        | Rising price                            |
| `--down`  | `#FF5C7A` | `text-down`      | Falling price                           |
| `--warn`  | `#FFB547` | `text-warn`      | Delayed or stale data                   |

Tailwind's default palette and all shadow utilities are removed, so only token colours compile.

Second palette, set with `<html data-palette="blue-orange">`: `--up: #5B8CFF`, `--down: #FF8A3D`.

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
- `Badge`: the truth badge. `LIVE 140ms`, `DELAYED 15m`, `EOD` or `OFFLINE`, plus the source. Cyan
  when live, amber when stale or delayed, grey when offline.
- `Cell`: a number in mono with tabular figures, optional sign, suffix and up/down tone. Missing
  values render as an em dash.
