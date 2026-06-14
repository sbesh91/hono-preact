# Section D: trim vestigial surface

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan
**Source:** Section D of the primitives DX review (`docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`): "Trim vestigial surface now, while it is cheap." One cleanup-sweep PR. Sections A, B, C are complete; D is the next backlog item.

## Goal

Remove or correct seven pieces of vestigial / orphaned / mislabeled surface across iso, server, vite, the scaffolder, the templates, the docs, and the ui package. Two of the seven listed in the review are already done (`getViewTransitionDirection` removed; the public `render()` constructor added), so this sweep covers the remaining seven items below.

## Framing: breaking changes are free right now

Nearly every change here is technically breaking (removing or renaming a public export). But nothing in this sweep, nor the rest of Sections A-C, has been released: `hono-preact` and `create-hono-preact` are still at their last published versions and everything since is unreleased. So these breaks cost no migration for any published consumer. That is the entire "while it is cheap" argument, and the reason to do all seven in one pass before a version bump freezes the surface.

## Scope: one PR, seven items

### 1. Remove `useRouteChange`; collapse the legacy route-change slot

`useRouteChange(handler)` (`packages/iso/src/route-change.ts`, exported from the iso barrel at `index.ts:138`) is undocumented and strictly subsumed by `useViewTransitionLifecycle.onAfterSwap`: both fire from the same internal slot. `fireAfterSwap` (`packages/iso/src/internal/route-change.ts`) calls `phaseSubs.afterSwap` subscribers AND `fireLegacy` (the `useRouteChange` path) at the same point, after the DOM swap and on every navigation (including VT-unsupported / skipped navs). So `useViewTransitionLifecycle({ onAfterSwap })` is an exact behavioral equivalent.

Changes:
- **Migrate the one consumer.** `apps/site/src/pages/demo/project-layout.tsx` uses `useRouteChange(() => window.scrollTo(0, 0))` for scroll-to-top. Replace with `useViewTransitionLifecycle({ onAfterSwap: () => window.scrollTo(0, 0) })` (swap the import from `useRouteChange` to `useViewTransitionLifecycle`).
- **Delete `route-change.ts`** (`useRouteChange` + the `RouteChangeHandler` type) and remove its barrel export.
- **Collapse the now-dead legacy slot:** remove `__subscribeRouteChange`, the `fireLegacy` call inside `fireAfterSwap`, the `fireLegacy` function and the `LegacySub` type plus the registry it reads (the list/set of legacy subscribers that `__subscribeRouteChange` appends to), and the `internal.ts` re-export of `__subscribeRouteChange`. `useViewTransitionLifecycle` is unaffected (it subscribes to `phaseSubs.afterSwap` directly via `__subscribePhase`). Confirm `route-change.ts` is the only consumer of `__subscribeRouteChange` before removing.

### 2. Remove the dead `/__actions` reservation

Page actions POST to the page URL (Spec C), so the reserved `/__actions` RPC path is dead. The live `/__loaders` RPC reservation stays.

Remove `/__actions` from:
- `packages/vite/src/server-entry.ts:98` `RESERVED_PATHS` (keep `LOADERS_RPC_PATH`), and the error-message string at `~:383` that lists `(/__loaders, /__actions)`.
- `packages/iso/src/internal/contract.ts:8` (the note about the `/__actions` reserved path staying literal).
- `packages/vite/src/module-key.ts:9` (comment mentioning `__loaders`/`__actions` RPC).
- `packages/create-hono-preact/templates/node/src/api.ts:4` and `.../cloudflare/src/api.ts:4` (the "reserved /__loaders and /__actions paths" comments).
- Update any test that asserts `RESERVED_PATHS` contains `/__actions` (e.g. in `server-entry.test.ts`).

### 3. Remove the `loaderUse`/`actionUse` convention and its dead machinery

Vite recognizes the export names `loaderUse`/`actionUse` as "reserved for future per-file middleware." PR #96 made per-file `use` obsolete (the route node's `use` is the single source), and already removed `pageUse` from the recognized-use list, leaving only `loaderUse`/`actionUse`. Removing those empties the concept entirely.

Remove:
- `loaderUse`/`actionUse` from `packages/vite/src/server-exports-contract.ts` (`RECOGNIZED_USE_EXPORTS`, and from `RECOGNIZED_SERVER_EXPORTS` if present), plus the explanatory comments.
- The F3 array-literal validation for these names in `packages/vite/src/server-loader-validation.ts`.
- The parser branch that collects `loaderUse`/`actionUse` in `packages/vite/src/server-loaders-parser.ts`.
- The `RECOGNIZED_USE_EXPORTS_SET.has(...)` guard in `packages/vite/src/server-only.ts`: with the set now empty, this path is always false and must be removed entirely (not left as a dead empty-set check). If `RECOGNIZED_USE_EXPORTS`/its `Set` become unused, delete them.
- Any tests asserting recognition/validation/parsing of `loaderUse`/`actionUse`.

The unrelated `const { fn, use: actionUse, ... }` destructure in `packages/server/src/page-action-handler.ts:175` is a local rename of an entry's `use` field, not this convention. It stays.

### 4. Demote the mutable `env` export to internal

`env` (`export let env: { current: 'browser' | 'server' }`, `packages/iso/src/is-browser.tsx`) is on the public barrel (`index.ts:135`, alongside `isBrowser`). Its only real consumer is the generated server entry, which does `import { Routes, env } from 'hono-preact'` then `env.current = 'server'` (`packages/vite/src/server-entry.ts:40,56`). A mutable runtime-mode flag is framework-internal plumbing, not a public utility.

Changes:
- Public barrel (`index.ts:135`) exports only `isBrowser` from `./is-browser.js`.
- Re-export `env` from `hono-preact/internal/runtime` (the generated-entry-stable internal tier established in Section B): add `export { env } from './is-browser.js'` to `packages/iso/src/internal-runtime.ts`.
- Codegen (`server-entry.ts:40`): split the import to `import { Routes } from 'hono-preact';` plus `import { env } from 'hono-preact/internal/runtime';`. Update the `server-entry.test.ts` assertion that checks the generated import line.
- Docs: remove `env` from the "Utilities" public re-export list in `apps/site/src/pages/docs/structure.mdx:65` (keep `isBrowser`, `prefetch`, the preact-iso re-exports).

`isBrowser()` stays public and unchanged.

### 5. Delete `apps/site/src/pages/noop.tsx`

Orphaned page (renders `<Route default component={noop} />`); not referenced by `apps/site/src/routes.ts`. Delete the file. Confirm no import references remain.

### 6. Fix the scaffolder version string

`packages/create-hono-preact/lib/cli.mjs:38` prints a hardcoded `console.log('create-hono-preact 0.1.0')`. The package is well past 0.1.0, so this is a stale-version bug. Read the version from the package's own `package.json` at runtime (resolve relative to the module URL, e.g. `import.meta.url` -> `../package.json`, and read its `version`) and print `create-hono-preact <version>`. Update the `cli.test.ts` case that asserts the `--version` output so it checks against the actual package version rather than the literal `0.1.0`.

### 7. Rename `useRender` -> `renderElement` (ui)

`useRender` (`packages/ui/src/use-render.ts`, public on the ui barrel at `index.ts:4`) is named like a hook but is provably a pure function: it imports no `preact/hooks`, calls none, and its body opens with a conditional early `return` (`if (typeof render === 'function') return render(...)`), which a real hook could never do. Several components rely on calling it conditionally / after early returns. The `use` prefix is a correctness-smell inherited from Base UI's port, where the equivalent genuinely is a hook (it calls React hooks internally); ours reimplemented the ergonomics without the hook internals, so it should not carry the prefix.

Changes:
- Rename the function `useRender` -> `renderElement`, and the internal options interface `UseRenderOptions<State>` -> `RenderElementOptions<State>`. Keep the public `RenderProp<State>` type name (it names the render prop, not the function).
- Update the ui barrel export (`packages/ui/src/index.ts:4`): `export { renderElement, type RenderProp } from './use-render.js';` (rename the file to `render-element.ts` is optional and not required; keeping `use-render.ts` is acceptable, but if renamed, update the import paths).
- Update all call sites (~13 across `select`, `menu`, `combobox`, etc.). Use Serena `rename_symbol` (off the worktree caveat: this runs in the primary checkout) for accurate, call-site-complete renaming; verify with a follow-up grep for `useRender`.
- Behavior is unchanged; the ui test suite + typecheck are the parity oracle.

## Testing strategy

- The cross-package backstop is `pnpm typecheck` + `pnpm test:coverage`: every removed/renamed public export, if still referenced anywhere, surfaces as a typecheck error or a failing consumer test. Run the consuming packages' suites, not just the editing package's.
- Item-specific test updates: `server-entry.test.ts` (RESERVED_PATHS no longer contains `/__actions`; the generated `env` import line moved to `internal/runtime`); the `server-exports-contract` / `server-loaders-parser` / `server-loader-validation` tests (drop `loaderUse`/`actionUse` cases); `cli.test.ts` (version assertion); remove any `useRouteChange` unit test; the ui suite covers `renderElement`.
- `pnpm --filter site build` verifies the `project-layout.tsx` migration and the `noop.tsx` deletion.
- `pnpm test:integration` covers the scaffolder.
- Full six-step pre-push CI before the PR.

## Out of scope (noted, not done)

- **Scroll restoration as a first-class primitive.** Migrating `useRouteChange` to `onAfterSwap` keeps scroll-to-top hand-rolled in the layout. A framework-native scroll-restoration primitive would be a Section-C-style addition, not a Section-D trim.
- **Section F dogfood-or-delete decisions** on `defineApp.use`, `speculation`, timeouts, observers, `Persist` (each needs a real site usage or a conscious keep-undemoed call). Separate effort.
- **Section E** UI contract-standardization items.

## Non-goals

No behavior change for any retained API. No new abstractions. This PR only removes, demotes, renames, or corrects existing surface.
