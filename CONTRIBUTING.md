# Contributing to Open Terminal

Thanks for reading this. Open Terminal is a static web app plus one small
edge Worker: there is no backend that holds market data, so almost every
change can be tested by opening the page.

## Setup

- Node 20+ and [pnpm](https://pnpm.io) (`corepack enable` is enough).
- `pnpm install`, then `pnpm dev` for the web app on
  `http://127.0.0.1:5173`.
- The edge Worker (`apps/edge`) needs [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
  and two secrets to serve FRED and SEC routes:
  `cd apps/edge && wrangler secret put FRED_API_KEY` and
  `wrangler secret put SEC_USER_AGENT` (your name and contact email, as SEC
  requires). Without them those routes answer 503 and say so; everything
  else works. Point the app at a local Worker with `VITE_EDGE_URL`.
- Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. CI runs
  all four on every push; a pull request needs them green.

## The rules that keep the project what it is

- **No key ever reaches the repo, a log, or our edge function.** Keys live in
  the visitor's browser and go only to their own provider. Never re-broadcast
  one account's data to all visitors: each user's key serves that user only.
- **A widget never opens a socket or calls a provider.** It asks the store
  (`store/hooks.ts`) for a symbol and channel; the feed hub owns every
  connection.
- **Every number shows its source and its age.** New data paths end in a
  truth badge (`LIVE`, `POLLED`, `EOD`, `DELAYED`, `OFFLINE`, …), and an
  empty panel says why it is empty (`design/notices.ts`).
- **Honesty over polish.** If a value is a proxy, an exchange price or a
  partial tape, label it. If a provider's limit differs from what the code
  assumes, say so in the pull request.
- **Design tokens only.** Colours, type and spacing come from
  `apps/web/src/design/tokens.css`; `docs/design.md` explains what each
  token may mean. Mint marks the interface, never a price move. No drop
  shadows, motion under 200 ms and off under reduced motion.
- **TypeScript strict, no `any` in `feeds/`.** Every adapter ships a test
  that replays a recorded message file (`feeds/adapters/fixtures/`) and
  checks the normalised output. Record fixtures with your own key and scrub
  them before committing.

## Adding a widget

Create `apps/web/src/widgets/<name>/meta.ts` and `index.tsx`. The app finds
both by file pattern (`app/widgets.ts`), so **adding a widget touches no
shared file**:

- `meta.ts` exports `meta: WidgetMeta`: a stable `id`, a `title`, an initial
  `defaultSize`, the words the command bar accepts (`aliases`), whether the
  dock may place it (`dock`) and what the command bar hands it (`input`:
  `symbol`, `symbols`, `query` or `none`).
- `index.tsx` default-exports a component taking dockview's panel props.
  Read data through the stores; report the feeds you show with
  `useReportSources(api.id, …)` so the header badge is truthful.
- Add styles to an existing sheet in `apps/web/src/design/` using tokens, or
  a new sheet imported by your widget.
- To appear in a preset workspace, add a panel to the JSON in
  `apps/web/src/workspaces/`.

## Adding a feed adapter

1. Implement `FeedAdapter` (`feeds/types.ts`): `id`, `needsKey`,
   `supports`, `subscribe`, `unsubscribe`, `connect`, `dispose`, and
   optionally `fetchHistory`, `fetchNews`, `verifyKey`. Emit normalised
   events through the context the hub gives you.
2. Register it in `feeds/adapters/index.ts` with its stale policy, symbol
   cap and key id, and put it in the fallback order in `feeds/router.ts`.
3. Record messages into `feeds/adapters/fixtures/` and write
   `<name>.test.ts` that replays them and asserts the normalised events.
4. Confirm the provider's free limits on the provider's own page and note
   them in `docs/data-sources.md`.

## Pull requests

- One change per request; describe what a reviewer should look at and how
  you verified it (a live link or the check you ran).
- Run `pnpm format` before committing; commit messages follow the existing
  style (`feat(scope): …`, `fix(scope): …`).
- Visual passes (the look of shell, widgets and signature views) happen in
  dedicated passes on their own branches; keep functional requests free of
  restyling so they stay reviewable.
- Anything that changes the adapter contract, the repo layout or the design
  tokens is a design decision: open an issue first.

## Not investment advice

Open Terminal shows market data as delivered by its public sources, for
information and for study of a free, honest terminal. Nothing in it is
investment advice, and nothing in it is guaranteed to be correct, complete
or timely.
