# Public/internal boundary, framework spine (Section B of the primitives DX review)

**Date:** 2026-06-11
**Status:** Approved design, pre-implementation
**Source:** Section B of `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`
**Goal:** Redraw the public/internal boundary deliberately before v1 freezes it by accident. Establish a three-tier stability model with structurally distinct doors, then apply it to the iso and server packages. No documented public symbol moves, so there is zero user-facing breakage; only JSDoc-private imports relocate.

## Scope decisions (locked with user)

1. **Framework spine only.** This spec covers the iso/server tier model, the boundary rule, server factory relocation, iso barrel leak fixes, and the SSE-codec question. The **ui boundary inversion** (promote `usePositioner`/`useListboxSelection`, demote the micro-helpers, export contexts so a custom part can read `activeId`) is deferred to its own follow-on spec; it is ui-ergonomics work that overlaps Section E and is a different kind of change.
2. **Boundary rule = intent + docs page.** Public means *intended for users AND has a docs page* (a live demo is not required; the live-demo gap stays a Section F "dogfood-or-delete" concern, separate from this structural work). Escape-hatch means *exported but explicitly unstable, "read the source."* Framework-emitted means *pure plumbing with no user composition story.*
3. **Separate subpath for the framework-emitted tier (Approach A).** A real door, not a naming convention or a manifest. The `__$..._hpiso` ugly-name convention is retained as defense-in-depth on the symbols that already have it.
4. **Door name follows the existing convention.** The one private door we already ship is `/internal`, so the framework-emitted tier nests under it as **`/internal/runtime`**. `/internal` remains the escape-hatch door. The server package gets `/internal/runtime` with no bare `/internal` (it has no escape-hatch tier), which is correct, not an inconsistency.
5. **SSE stays minimal.** The review's premise ("encoder `sseGeneratorResponse` is public") is false today: the encoder is package-private and the decoder `readSSE` is consumed internally via source import, with its only door presence an undogfooded escape-hatch export. No new server door, no encoder export. See §5.

## The tier model

Three tiers, each a distinct stability contract behind a distinct door:

| Tier | Stability contract | iso door | server door |
|---|---|---|---|
| **Public** | semver-stable, supported, documented | `.` (barrel) | `.` |
| **Escape-hatch** | exported, may change in any minor, "read the source" | `/internal` | (none) |
| **Framework-emitted** | co-versioned private plumbing; users never import | `/internal/runtime` | `/internal/runtime` |

**Membership rule for the framework-emitted tier** (the enforceable invariant): a symbol belongs on `/internal/runtime` only if it is *pure plumbing with no user composition story*, concretely one of:

- a symbol the framework's codegen **emits** into generated user code (the client-entry installers, the server-only loader stub, the server-entry resolver factories), or
- the cross-package **wire-contract constants** module (`internal/contract.ts`), consumed by our own vite plugins at build time and by iso/server source at runtime.

Everything else currently on iso `/internal` stays escape-hatch, **even when the server package imports it** (e.g. `HonoRequestContext`, `RENDER_PAGE_SCOPE_MESSAGE`, the `fan*` helpers). The server package is co-versioned framework code and is allowed to consume the escape-hatch tier; cross-package internal use does not promote a symbol to tier 3. Tier 3 is reserved for symbols with no coherent advanced-user story at all.

## PR B1: server boundary

`packages/server/src/index.ts` today exports, undifferentiated: `HonoContext`, `useHonoContext`, `renderPage`, `loadersHandler`, `routeServerModules`, `makePageUseResolvers`, `makePageActionResolvers`, `pageActionHandler`, `ActionEntry`, `PageActionHandlerOptions`.

**Public `.` (after):** `HonoContext`, `useHonoContext`, `renderPage`, `loadersHandler`, `pageActionHandler`, `ActionEntry`, `PageActionHandlerOptions`, and a **newly added re-export of `LoadersHandlerOptions`** (from `loaders-handler.ts:104`). This closes the documented custom-wiring gap: today a hand-rolled handler can call `loadersHandler` but cannot name its own options type.

**New `/internal/runtime` door:** `routeServerModules`, `makePageUseResolvers`, `makePageActionResolvers`. These exist only because the generated server entry imports and calls them; they have no standalone user story. Note the three relocating symbols are all *values* (functions); no type moves, so no public signature is left referencing a now-private type. In particular **`ActionEntry` stays public** even though it is defined next to `makePageActionResolvers`, because `PageActionHandlerOptions.resolverByPath` (`(path: string) => Promise<Map<string, ActionEntry>>`) is part of the public `pageActionHandler` options surface; a hand-wired handler must be able to name it.

- New file `packages/server/src/internal-runtime.ts` re-exporting the three factories from their source modules (`route-server-modules.ts`, `page-action-resolvers.ts`), with a tier-3 header (see §6).
- `package.json` adds `"./internal/runtime": { "types": "./dist/internal-runtime.d.ts", "import": "./dist/internal-runtime.js" }`.

**`pickAccept`** (`page-action-handler.ts:89`) loses its `export` keyword. It is already unreachable from any package door; its lone consumer is a unit test that imports the source module directly. Module-private is the honest state.

**Codegen + tests:**
- `packages/vite/src/server-entry.ts` changes its generated import from `hono-preact/server` to `hono-preact/server/internal/runtime` for the three factories (the public `loadersHandler`/`renderPage`/`pageActionHandler` imports stay on `hono-preact/server`). Update `server-entry.test.ts` expected output strings accordingly.
- New `LoadersHandlerOptions` re-export gets a one-line type-surface assertion in the server package's public-API test (or a `tsd`-style check if one exists).

## PR B2: iso boundary

### New `/internal/runtime` door

New file `packages/iso/src/internal-runtime.ts`, exporting exactly the plumbing tier:

- **Installers** (codegen-emitted by the client-entry): `installHistoryShim`, `installNavTransitionScheduler`, `installStreamRegistry`.
- **Loader stub** (codegen-emitted by server-only): `__$createLoaderStub_hpiso`.
- **Wire-contract constants** (the whole `internal/contract.ts` module): `LOADERS_RPC_PATH`, `CLIENT_ENTRY_FILE`, `CLIENT_ENTRY_URL`, `VIRTUAL_CLIENT_ID`, `VIRTUAL_CLIENT_DEV_URL`, `MODULE_KEY_EXPORT`, `LOADER_NAME_OPTION`, `FORM_MODULE_FIELD`, `FORM_ACTION_FIELD`.

`package.json` adds `"./internal/runtime"`. Relies on iso's existing `sideEffects: false` so a vite plugin importing one constant does not drag installer runtime code into the build graph.

### `/internal` becomes escape-hatch-only

`packages/iso/src/internal.ts` loses the symbols listed above. Everything else stays (the compose-by-hand escape hatches: `Loader`, `Envelope`, `RouteBoundary`, `OptimisticOverlay`, the action-envelope codec, contexts, request-scope helpers, `PageMiddlewareHost`, `dispatchServer`/`dispatchClient`, `partitionUse`, the `fan*` helpers, `useRender`, `mergeRefs`, `readSSE`, etc.). Specifically note:

- The `history-shim` re-export splits: `installHistoryShim` moves to `/internal/runtime`; `getNavDirection` stays on `/internal` (it has a user-facing "get nav direction" story and is reachable there already).
- The file header is rewritten: the obsolete in-file "Section 1 / Section 2" comment split is removed (the split is now a real subpath), and the stability disclaimer becomes honestly *unstable*, no longer hedged by also covering plumbing the framework's own emitted code requires.

### Barrel leak fixes (`packages/iso/src/index.ts`)

- **Remove** the `export { getNavDirection as getViewTransitionDirection } from './internal/history-shim.js'` re-export (`index.ts:147`). It is an undocumented barrel rename of an internal symbol. It remains reachable as `getNavDirection` on `/internal`. (Full deletion of the symbol is a Section D call and is out of scope here.)
- **`ViewTransitionEvent`** already lives correctly as a *type-only* export on the barrel (`index.ts:134`, part of the public `useViewTransitionLifecycle` callback signature) and as a *value* on `/internal` (`internal.ts:75`). This split is intentional and stays; the design only documents the rationale in a comment so it is not "fixed" into a leak later.

### Codegen + plugin imports

- `packages/vite/src/client-entry.ts`: generated import of the three installers changes from `hono-preact/internal` to `hono-preact/internal/runtime`. Its own build-time `VIRTUAL_CLIENT_ID` import changes from `@hono-preact/iso/internal` to `@hono-preact/iso/internal/runtime`.
- `packages/vite/src/server-only.ts`: generated `__$createLoaderStub_hpiso` import changes from `hono-preact/internal` to `hono-preact/internal/runtime`; its build-time constant imports (`MODULE_KEY_EXPORT`, `LOADER_NAME_OPTION`, `FORM_MODULE_FIELD`, `FORM_ACTION_FIELD`) change to `@hono-preact/iso/internal/runtime`.
- `packages/vite/src/hono-preact.ts` (`CLIENT_ENTRY_FILE`), `server-entry.ts` (`LOADERS_RPC_PATH`), `module-key-plugin.ts` (`MODULE_KEY_EXPORT`, `LOADER_NAME_OPTION`): build-time constant imports change to `@hono-preact/iso/internal/runtime`.
- Update `client-entry.test.ts` and the `__tests__/fixtures/leak-test/vite.config.ts` alias fixtures to the new specifiers.

### The invariant test

A new test asserts the `/internal/runtime` door cannot drift from what the framework actually emits:

1. Its non-constant exports == the set of symbols the codegen emits (the installers + the loader stub), derived from the same generated-string sources the existing codegen tests check.
2. Its constant exports == the public exports of `internal/contract.ts` (the whole wire-contract module, re-exported as a unit).

## Umbrella package (`hono-preact`)

The umbrella ships a self-contained tarball; `scripts/consolidate.mjs` copies each sub-package's `dist/` in and rewrites `@hono-preact/*` import specifiers to file-relative paths using its `DIST_PATHS` map. Three coordinated changes:

1. **New re-export files:** `src/internal-runtime.ts` (`export * from '@hono-preact/iso/internal/runtime'`) and `src/server-internal-runtime.ts` (`export * from '@hono-preact/server/internal/runtime'`).
2. **`package.json` exports:** add `"./internal/runtime"` → `dist/internal-runtime.js` and `"./server/internal/runtime"` → `dist/server-internal-runtime.js`. `"./internal"` stays mapped to the iso escape-hatch door.
3. **`consolidate.mjs` `DIST_PATHS`** gains `'@hono-preact/iso/internal/runtime': 'iso/internal-runtime.js'` and `'@hono-preact/server/internal/runtime': 'server/internal-runtime.js'`. This is the easy-to-miss step: without it, the vite plugins' build-time constant imports (rewritten in the shipped dist) and the umbrella re-export files fail to resolve in a user's installed environment.

Codegen emits umbrella specifiers (`hono-preact/internal/runtime`, `hono-preact/server/internal/runtime`) because user apps depend on `hono-preact`, not the workspace-private sub-packages. The vite plugins' own source uses workspace specifiers (`@hono-preact/iso/internal/runtime`), which `consolidate.mjs` rewrites at publish time.

## SSE codec (§5): minimal touch

Facts established during design:
- `sseGeneratorResponse` (encoder) is **package-private** in `packages/server/src/sse.ts`; its only consumers are `loaders-handler.ts` and `page-action-handler.ts`. It is on no door.
- `readSSE` (decoder) is consumed **internally via source import** by `action.ts` and `internal/loader-fetch.ts`; its only *door* presence is the escape-hatch export on iso `/internal`, dogfooded nowhere.

So the "codec split across stability tiers" problem is largely illusory. The minimal, correct action:
- Keep `readSSE` as the one blessed escape-hatch on iso `/internal`, grouped under a clear "SSE codec (decoder)" header.
- Add a short comment recording that the encoder and the SSE wire format are intentionally framework-internal (package-private), so a future contributor does not "promote" the encoder for false symmetry.

No new server escape-hatch door, no encoder export. This folds into PR B2 (it only touches iso `/internal`'s header), so there is no separate B3.

## Breaking-change posture

Zero documented-API breakage: no symbol with a docs page changes location. The only relocations are JSDoc-private imports (`routeServerModules`/`makePageUseResolvers`/`makePageActionResolvers` off the public `/server` door; `getViewTransitionDirection` off the iso barrel; the iso installers/stub/constants from `/internal` to `/internal/runtime`). Anyone who reached past the JSDoc-private notes loses those import paths; that is exactly the pre-v1 cleanup this section exists to do. Lands in the next minor with a changelog note. Release pressure is zero and no release work is in scope.

## PR decomposition

- **PR B1 (server):** factories → `/internal/runtime`, re-export `LoadersHandlerOptions`, de-export `pickAccept`, server-entry codegen update + tests. Self-contained within the server + vite packages.
- **PR B2 (iso):** new `/internal/runtime` door (installers + stub + contract module), `/internal` reduced to escape-hatch + header rewrite + SSE comment, barrel leak fix, client-entry/server-only/plugin codegen + the invariant test + leak-test fixtures.

Both PRs touch the umbrella (`package.json` exports + `consolidate.mjs` + the two re-export files); the umbrella changes naturally split by which sub-package each subpath points at, so each PR carries its own umbrella half. Order is flexible (the two doors are independent), but landing B1 first keeps the smaller, lower-risk change ahead of the iso churn.

## Out of scope (deferred to follow-on specs)

- **ui boundary inversion** (Section B's ui bullet): promote `usePositioner` + `useListboxSelection` to a supported tier, demote the micro-helpers (`getItems`, `wrapNext`, `matchTypeahead`, `OPTION_SELECTOR`), export or wrap contexts so a from-scratch custom part can read `activeId`. Its own spec.
- **Section D trims** that brush against this work (`getViewTransitionDirection` full deletion, mutable `env` export, `loaderUse`/`actionUse`).
- The **Section F live-demo gap** for legitimately-public-but-undemoed API (`createCache`, timeouts, `Persist`, `useRouteMatch`, etc.). This spec keeps them public; dogfooding them is separate.
