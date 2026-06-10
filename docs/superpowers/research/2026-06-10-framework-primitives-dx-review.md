# Framework primitives deep review: long-term DX, simplicity, and composability

**Date:** 2026-06-10
**Status:** Research / design review only (no implementation intent)
**Question:** Reviewing every concept across `packages/`, how healthy are the framework primitives for long-term developer experience? What does `apps/site`'s actual usage reveal, and what should guide future work to keep the framework simple and composable?

## TL;DR

- **The conceptual core is good.** One outcome vocabulary end to end, a fail-loud build layer, a consistent render-prop + data-attribute contract across all 7 UI overlays, and a real adapter seam.
- **The risk is distribution, not concepts.** The same semantics are implemented in multiple places (envelope decoded twice on the client, outcome translation welded into four server channels, route matching implemented three times, cross-package string literals with no shared constant).
- **The public/internal boundary is eroding from both sides.** Framework-private factories ride public entries; the main barrel re-exports `internal/` modules; `/internal` cannot actually be unstable because generated code depends on it; in `ui`, micro-helpers are public while the most load-bearing hooks (`usePositioner`, `useListboxSelection`) are internal.
- **The site is a precise spec for six missing primitives**, each hand-rolled twice or more: form success lifecycle, client-visible auth state / imperative navigate, prefetching links, typed route params, single-source page guards, content/MDX sub-routing.
- **Guidance:** consolidate semantics before adding surface, redraw the boundary before v1 freezes it, build the six site-discovered primitives, trim vestigial exports now, move the `ui` dedup trigger from "fifth copy" to "second copy", and adopt dogfood-or-delete plus contracts-start-shared as standing rules.

## Method

Six parallel read-only review agents covered: iso routing/loaders/actions/middleware; iso view transitions/streaming/config + umbrella export map; the server runtime + adapters; the vite plugin + scaffolder; `@hono-preact/ui`; and a usage audit of `apps/site/src`. Findings below are synthesized from their reports, with file citations preserved.

## What is healthy and worth protecting

- **Outcomes as shared currency.** `redirect`/`deny`/`render`/`timeout` are pure data + guards (`packages/iso/src/outcomes.ts`), consumed identically by the middleware runner, `useAction`, `Form`, and `PageMiddlewareHost`. The cleanest seam in the framework.
- **One middleware composition rule**, `[...appConfig.use, ...pageUse, ...unit.use]` outer-to-inner, documented identically in both server handlers (`loaders-handler.ts:264-269`, `page-action-handler.ts:219-223`), with return-vs-throw outcome normalization and consistent timeout discrimination.
- **Fail-loud build layer.** The vite plugin converts would-be silent failures into build errors with remediation text: `.server.*` export-shape validation, api.ts route-shadowing detection via AST walk, app-config default-export check (`packages/vite/src/server-entry.ts:122-220, 338-350`). Unusually defensive for a young framework.
- **The adapter interface** (`packages/vite/src/adapter.ts`: `name`, `vitePlugins(ctx)`, `wrapEntry(ctx)`) is a small, public, proven seam; the node adapter implements the hard case in ~190 lines from outside knowledge.
- **CSRF by mount order** (user `api.ts` mounts ahead of all framework POST handlers, verified by test) is a convention rather than an API, and it works.
- **UI contracts.** The `render` prop (`use-render.ts`) and the `data-state`/`data-side`/`data-align`/`data-highlighted` styling contract are highly consistent across Dialog, Popover, Tooltip, Menu, ContextMenu, Select, Combobox. The controlled/uncontrolled triplet (`value`/`defaultValue`/`onXChange` via `useControllableState`) is uniform. Standalone primitives (`usePosition`, `usePresence`, `useDismiss`, `useSafeArea`, `useListNavigation`, `useTypeahead`, `useControllableState`) are genuinely context-free and reusable.
- **Three-layer routing stack** `useRouteMatch` → `useRouteActive` → `NavLink`, and the `useOptimistic` → `useOptimisticAction` → `Form` composition through the `OPTIMISTIC_BRAND` symbol (no casts at the seam).
- **`useListboxSelection`'s sole `as Value` cast confinement** (`packages/ui/src/listbox/selection.ts`) matches the repo cast policy.

## Cross-cutting findings

### 1. One vocabulary, many translators

The same semantics live in N implementations that must agree:

- **Envelope decode ×2 (client).** `Form` (`form.tsx:107-159`) and `useAction` (`action.ts:405-477`) independently parse the `__outcome` wire format with diverging edges: Form treats `timeout` as unknown-outcome fallthrough (`form.tsx:152`) while `useAction` raises a typed `TimeoutError`; Form falls back to `window.location.reload()` on malformed bodies (`form.tsx:104`).
- **Outcome translation ×4 (server).** `translateRootOutcome` (`render.tsx:56`), `translateOutcomeForLoader` (`loaders-handler.ts:146`), `serializeActionOutcome` (iso `internal/action-envelope.ts`), plus the action HTML/PE branch (`page-action-handler.ts:326-390`). The tell: the "render outcome is page-scope only" defense exists in three separate files.
- **Route matching ×3.** The preact-iso client matcher plus identical hand-mirrored `urlPathMatchesPattern`/`patternScore` copies in `route-server-modules.ts:36-65` and `page-action-resolvers.ts:51-72`.
- **Cross-package string literals with no shared constant.** `static/client.js` (hardcoded in `packages/vite/src/hono-preact.ts:82` and `packages/iso/src/client-script.tsx:5`); `/__loaders` in three places across two packages; the dev script URL `/@id/__x00__virtual:hono-preact/client` encoding both Vite's `\0` convention and the virtual id; the generated entry path agreed between plugin constant and scaffolded `wrangler.jsonc` only textually. `__moduleKey` parity between client stubs and server injection is held together by a parity test; the runtime failure mode is a 404 at request time.
- **Resolver duplication ×2 (server).** `makePageUseResolvers` and `makePageActionResolvers` are near-isomorphic (thunk cache, ancestor walk, dev-rebuild, best-pattern scan); a third per-module-export concept clones it a third time.

### 2. The public/internal boundary erodes from both directions

- **Server:** framework-private factories (`routeServerModules`, `makePageUseResolvers`, `makePageActionResolvers`) ride the public `hono-preact/server` entry with JSDoc-only privacy ("Reach for it at your own risk", `route-server-modules.ts:117`). `pickAccept` is module-public "for unit testing only". `LoadersHandlerOptions` is not re-exported from the index, so the documented custom-wiring path cannot name its own options type.
- **Iso:** the main barrel re-exports `internal/` modules directly: `getViewTransitionDirection` is a barrel rename of internal `getNavDirection` (`index.ts:147`); `ViewTransitionEvent` is a stable type on the main barrel but an unstable value on `/internal`. The public semantics of the VT types/lifecycle APIs are defined entirely inside `internal/route-change.ts`.
- **`/internal` cannot actually be unstable.** The generated client entry hard-depends on it (`installHistoryShim`, `installNavTransitionScheduler`, `installStreamRegistry`, `client-entry.ts:18`) and `packages/server/src/sse.ts` imports the fan helpers from it. Its instability disclaimer applies to a subpath the framework's own emitted code requires at runtime. Docs already point into it once (`OptimisticOverlay` in optimistic-ui.mdx), and each such pointer converts an unstable export into a de-facto stable one.
- **UI, inverted:** micro-helpers (`getItems`, `wrapNext`, `wrapPrev`, `matchTypeahead`, `OPTION_SELECTOR`, `matchSubstring`) are public, while `usePositioner` (top-layer promotion, the UA-`[popover]` style neutralization in `POSITIONER_STYLE`, presence interplay, `mount` strategy; `use-positioner.ts`) and `useListboxSelection` (registry/version threading encoding the PR #82 stale-label fix, hidden-field form serialization) are internal. The knowledge in `usePositioner` is not re-derivable from docs; anyone building a custom anchored overlay from the public hooks must rediscover UA quirks the framework already paid for.
- **SSE codec split across stability tiers:** decoder `readSSE` is iso `/internal`; encoder `sseGeneratorResponse` is public `@hono-preact/server`.

### 3. Copy-then-dedup is the growth mode, and dedups lag

Both completed UI extractions (`usePositioner` PR #83, `useListboxSelection` PR #80) and the pending `useMenuCore` (spec at `docs/superpowers/specs/2026-06-10-menu-core-dedup-design.md`) formed only after 3 to 5 copies existed. Post-dedup residue today:

- Arrow part byte-near-identical ×5 (`popover.tsx:234-254`, `tooltip.tsx:276-296`, `menu.tsx:609-629`, `select.tsx:476-496`, `combobox.tsx:363-383`)
- OptionGroup/GroupLabel labelId-context pattern ×3; Option registration layout-effect ×2 (same comment verbatim); description registration ×2 (`dialog.tsx:49-53`, `popover.tsx:57-61`); on-open highlight-selected effect ×2
- Position-state plumbing through 6 Roots solely so Arrow can read it
- Hand-maintained context memo dep arrays ×7 Roots (Combobox's is 28 entries)

### 4. Global singletons coordinate the client runtime

History shim (monkey-patched `history`), nav-transition scheduler (sole owner of `options.debounceRendering`, with module-level `loadingDepth`/`navGen`/`transitionActive`), stream registry (`window.__HP_STREAM__`), Persist registry, dismiss-stack singleton (`packages/ui/src/dismiss-stack.ts:20`), mutable `env` export, and the `globalThis` loader-cache map whose own comment calls it "an implicit footgun" to fix "in v0.2" (`define-loader.ts:108-120`, still present). Each is individually justified; collectively, correctness depends on install order and single-owner assumptions.

### 5. Hidden placement and coupling knowledge

- `useAction`'s `invalidate` behavior silently changes with the enclosing Boundary's "active loader" context (`action.ts:117-134, 223-224`).
- Public `Routes` is silently load-bearing for cold-nav view transitions via `onLoadStart`/`onLoadEnd` (`define-routes.tsx:470-477`); dropping to raw `Router` (also exported from the barrel) loses coordination with no warning.
- `useViewTransitionTypes` vs `subscribeViewTransitionTypes` requires hook-lifecycle blind-spot knowledge; lifecycle has no subscribe twin despite the same blind spot.
- `defineLoader` without the vite transform produces an unkeyed loader that throws at render; nothing in the type distinguishes it.
- `#app` and `<ClientScript/>` come from the user's Layout; renaming or omitting them silently produces a dead page.
- Cookies must be set before a streaming loader's first yield (`render.tsx:328-337`).
- `SubmenuPopup` outside `SubmenuPositioner` silently binds to the parent menu's context (`submenu.tsx:306-319`); the only silent wrong-context failure in `ui`.

### 6. Smaller per-package frictions worth recording

**Iso (routing/loaders/actions):**
- Route params untyped everywhere (`pathParams: Record<string,string>`); `defineLoader`'s `params` cache-key list is stringly and unchecked against the route pattern.
- `LoaderRef` is a god-object: fn + cache + 2 hooks + 2 components + middleware + timeout + plugin metadata; the data half is inseparable from the rendering half.
- `RenderOutcome` type and `isRender` guard are public but there is no public `render()` constructor.
- Three names around refresh (`useReload`, `invalidate`, View's `reload` arg); `useAction` exists as both free hook and stub method.
- Casts at public seams: `defineAction`'s dual-shape `as unknown as ActionStub` (`action.ts:88-114`), `useData() as T`, `useActionResult` payload casts with an admitted type/runtime mismatch for form posts, `collectFormData(fd) as TPayload`.
- `useActionResult`/`useFormStatus` are backed by module+action-keyed global stores, so two forms sharing an action share status.
- Single-entry loader cache with `locKey: null` matches-any back-compat semantics; prefetch must know about the collision (`prefetch.ts:93-96`).

**Iso (VT/streaming/config):**
- The VT surface is a 2×2 (hook/component × name/class) plus a hook/subscribe duality applied inconsistently (types has both, lifecycle has hook only). `ViewTransitionGroup` is named for the pseudo-element it targets, not the property it sets.
- `useRouteChange` is undocumented and strictly subsumed by `useViewTransitionLifecycle.onAfterSwap` (same internal slot, `internal/route-change.ts:121-126`).
- Scheduler heuristics are tuned magic: `COLD_COMMIT_TIMEOUT_MS = 500`, `MORPH_PARTNER_GRACE_MS = 150`, a `[style*="view-transition-name"]` DOM scan.
- `ViewTransitionEvent.set/get` is an unkeyed `Map<unknown, unknown>` stash on a public type; invites untypeable cross-phase protocols.
- `speculation: boolean` with hardcoded rule JSON is the classic boolean-that-becomes-an-object.
- `env` is a mutable exported let on the main barrel next to `isBrowser()`; user code can corrupt SSR detection.
- Iso's `./page` subpath maps to `page-only.ts` while `page.tsx` is the `<Page>` component; maintainer-side grep trap.

**Server:**
- `pageActionHandler` takes its own sibling `renderPage` and `resolvePageNode` as injected options; forgetting `resolvePageUseByPath` silently drops page middleware on actions (`page-action-handler.ts:38-41`). A hand-rolled entry must replicate ~10 lines of resolver plumbing exactly.
- `appConfig`/`dev`/`defaultTimeoutMs`/`onError` are threaded per handler with no shared server-config object; `onError` ctx shapes differ only in a field name.
- `serverLoaders` accepts a raw-function shape that exists "(used by unit-test fixtures)" per its own comment (`loaders-handler.ts:64-83`); `serverActions` metadata rides non-enumerable function properties (`page-action-resolvers.ts:25-33`).
- Reserved path `/__actions` has no runtime handler anywhere; vestige of the pre-Spec-C design.
- HTML assembly is a weld: head injection by string-replacing `</head>`, the `startsWithHtml` shell heuristic, and the `__HP_STREAM__` pump (~150 bespoke lines, the third streaming wire format alongside the two SSE pumps).

**Vite plugin / scaffolder:**
- The `.server.*` suffix regex is inlined in at least 5 files; the 5-export allowlist is closed (extending means forking three plugins' shared contract).
- `moduleKeyPlugin` only rewrites top-level `defineLoader` calls (`module-key-plugin.ts:108-110`); a loader built through a helper silently misses key threading.
- Any unrelated file named `*.server.ts` is conscripted into the convention by filename alone.
- The generated core app is string-concatenated codegen with no injection point; custom 404 or SSR wrapper means abandoning `serverEntryPlugin` (possible via `hono-preact/server` exports, undocumented as a path).
- `loaderUse`/`actionUse` are recognized, validated, stubbed, and unread (`server-exports-contract.ts:20-25`): convention surface shipped ahead of behavior.
- Scaffolder: CLI prints hardcoded `0.1.0` while package.json says `0.5.0` (`lib/cli.mjs:38`); the two templates' `src/` trees are byte-identical by discipline only; templates pin `preact-iso` to a git ref; no template demonstrates actions, `pageUse`, app-config, view transitions, or speculation, so the sharpest-edged conventions have no scaffolded example.
- Node adapter's `injectWebSocket` is a magic optional export name on `api.ts`, documented nowhere in types; `apiModuleId` widened the shared adapter context for this one case (the canonical adapter-interface growth pattern).

**UI:**
- Root prop counts: Dialog 4, Popover 7, Tooltip 9, Menu 9, ContextMenu 9, Submenu 9, Select 17, Combobox 21. No shared positioning-props or selection-props type, so drift is structural.
- `onValueChange?: (value: Value | Value[]) => void` forces hand-narrowing; `multiple` is not in the type.
- Delay props: Tooltip `delay`/`closeDelay` vs Submenu `openDelay`/`closeDelay`. Default `align` and `offset` diverge per component, undocumented.
- `data-state` overloaded to `"checked"/"unchecked"` on MenuCheckboxItem/MenuRadioItem (`menu.tsx:432,542`) vs `"open"/"closed"` everywhere else; a future Checkbox/Switch could fork a third way.
- Two different "Value" part models: `SelectValue` (function-as-children + `render`, `{selectedLabels}`) vs `ComboboxValue` (function-as-children only, bare Fragment, `{selectedItems, remove}`); `ComboboxValueState` is the one public leak of generic erasure (`value: unknown`, `remove: (value: unknown) => void`, `combobox.tsx:906-909`).
- `useRender` contains no hooks; four components legally early-return before calling it (`popover.tsx:182`, `tooltip.tsx:200`, `menu.tsx:263`, `combobox.tsx:897`). Any future hook inside it, or enabling eslint-plugin-react-hooks, breaks/flags all four. The name misstates the contract.
- Menu items' `onSelect` receives a synthetic cancelable `Event` as the keep-open channel (`menu.tsx:204`); a pattern appearing nowhere else; Select/Combobox options have no per-option callback.
- Hardcoded English strings in Combobox (Status text, trigger/clear aria-labels) with inconsistent override mechanisms; the library's only user-visible strings.
- No contexts are exported, so a from-scratch custom part cannot reach e.g. Menu's `activeId`; safe-area geometry (`buildSafePolygon`) is internal, blocking custom corridors (RTL submenus).

## What apps/site reveals (dogfood audit)

**Blessed and working:** multi-loader pages with streaming generator loaders and `ctx.signal` abort checks; `View`-with-fallback composition; optimistic actions driving both list and `<Form>`; the public VT API end to end (`subscribeViewTransitionTypes` in `docs-transition.ts`, persistent-layout `useViewTransitionTypes`, `ViewTransitionName` morphs); UI demos that import only the barrel, use namespace parts, style purely via the data-attribute contract, and collectively cover nearly every component part with zero backdoors.

**Hand-rolled 2+ times, i.e. missing primitives:**

1. **Form success lifecycle.** Success-detection effect with manual dedup, twice, differently: ref-dedup (`project-issues.tsx:15-22`) and key-remount + invalidate (`issue.tsx:135,161-166`). `Form` has no `onSuccess`/`reset`/`invalidate`; `useAction` does have `onSuccess`.
2. **Client-visible auth state / post-action navigation.** A localStorage session hint written, self-healed, cleared, and read across four files (`login.tsx:17-24`, `projects.tsx:46-53`, `projects.tsx:17-21`, `guard.ts:36`), with comments documenting the races; logout is a full `window.location.assign` because there is no imperative client navigate outside middleware.
3. **Prefetching link.** Manual `onMouseEnter`/`onFocus` wiring plus a copy-declared route-pattern string next to the `href` (`IssueRow.tsx:9,17-20`); nothing connects `prefetch()`, the manifest, and `NavLink`.
4. **Typed route params.** `(route.pathParams as { projectId?: string })` (`project-layout.tsx:7`); stringly param reads in all three `.server.ts` loaders.
5. **Single-source page guards.** The `use` + `pageUse` mirror copy-pasted across 3 page pairs; a forgotten `pageUse` is an auth hole.
6. **Content/MDX sub-routing.** `DocsRoute.tsx` is a hand-built glob router with a slug deriver, a per-MDX `<article>` wrapper working around Fragment-root hydration inside Suspense, and the same-component-reference trick to make docs→docs navs non-route-changes (`DocsRoute.tsx:8-13,51-58`). Deep preact-iso internals knowledge living in app code.

**Never exercised by the site (real code):** `defineApp` (no app-config file at all), `speculation` (the docs tell users to enable it; the site doesn't), `createCache`, timeouts, `defineStreamObserver`, `Persist`/`PersistHost`, `useRouteMatch`, `useReload`, `useOptimistic` (raw), `Page`, `Routes`-as-import, `isBrowser` (site hand-rolls `typeof window` twice), `ViewTransitionGroup`, the VT lifecycle hook, and every `ui` primitive hook (`usePosition`, `useDismiss`, `useListNavigation`, `useSafeArea`, `useFocusReturn`, `useTypeahead`, `mergeRefs`, `useRender`, `useControllableState`): their docs pages are snippet-only, no live demos, so those public APIs are executed nowhere in the repo. Also unused parts: `PopoverAnchor`, Menu/Select/Combobox `Arrow`, `Combobox.Clear`. Cosmetic drift: 4 files import `Route`/`Router`/`useLocation` from `preact-iso` directly instead of the umbrella. Orphan file: `apps/site/src/pages/noop.tsx`.

## Guidance for future work

### A. Consolidate semantics before adding surface

1. **Single envelope codec** shared by `Form` and `useAction`; single outcome-translation registry on the server. Same shape of work as the Positioner dedup: one meaning, one implementation.
2. **One route matcher** shared by the two server resolver files, ideally derived from the matcher preact-iso uses.
3. **Shared constants module** for cross-package literals (`/__loaders`, `static/client.js`, virtual ids, generated paths), following the `server-exports-contract.ts` precedent, which exists because this drift class already bit once.
4. **Merge the resolver-factory twins** before a third per-module-export concept clones the pattern.

### B. Redraw the public/internal boundary deliberately, before v1 freezes it by accident

Adopt one rule, e.g. "public means documented with a live demo; everything else is `/internal`". Then:
- Move the server resolver factories (and `pickAccept`) off the public `/server` entry; re-export `LoadersHandlerOptions` properly.
- Stop re-exporting `internal/` modules from the iso main barrel.
- Split `/internal` into a stable framework-emitted tier (the generated entry's dependencies can never be unstable) and a true escape-hatch tier.
- In `ui`: promote `usePositioner` and `useListboxSelection` (they encode knowledge users cannot re-derive); consider demoting the micro-helpers; export or wrap contexts enough that a custom part can participate (e.g. read `activeId`).
- Reunite the SSE codec on one subpath/stability tier.

### C. Build the six site-discovered primitives instead of new feature areas

Form `onSuccess`/`invalidate`; imperative client `navigate`; prefetch-on-intent in `NavLink`; typed route params (even a manual generic on `defineRoutes` beats casts); manifest-level `use` to kill the `pageUse` mirror; a content-glob route helper subsuming `DocsRoute.tsx` (hydration workaround included). Each deletes documented workaround code from the flagship app, the strongest signal they're right.

### D. Trim vestigial surface now, while it is cheap

`useRouteChange` (subsumed); `getViewTransitionDirection` (orphaned, undocumented); mutable `env` export (export only `isBrowser`); the dead `/__actions` reservation; `loaderUse`/`actionUse` (unread convention surface); the missing public `render()` constructor (add it or unexport the type+guard); the site's `noop.tsx`; the scaffolder's hardcoded CLI version string; and rename `useRender` (it is not a hook, and four components depend on that secret).

### E. UI: move the dedup trigger from "fifth copy" to "second copy"

Ship `useMenuCore` (spec fd2541f), then in the same spirit extract the Arrow part, the group-label context, and the position-state plumbing before the next slice replicates them. Standardize the small contract forks while there are only seven components: one delay vocabulary (`openDelay`/`closeDelay`), one `Value` part model, `data-checked` instead of overloading `data-state`, one popup-id prop name. Introduce shared `PositioningProps`/`SelectionProps` types so per-Root defaults are declared divergence, not drift. Fix the one public erasure leak (`ComboboxValueState`).

### F. Standing rules

1. **Dogfood-or-delete.** A public export the site neither uses nor live-demos is a candidate for `/internal` or removal. `defineApp.use`, `speculation`, timeouts, observers, and `Persist` should each gain a real site usage or a conscious keep-undemoed decision. Primitive docs pages should get live demos; they are currently the only untested public surface.
2. **Contracts start shared.** When a new feature needs cross-package agreement (a path, a shape, an export name), it starts life in a shared contract module, not as matching string literals.

## Closing observation

The framework's simplicity is real but it currently lives in discipline: identical doc comments in two handlers, byte-identical template trees, parity tests for independently derived keys, JSDoc privacy notes. The work above is mostly about converting that discipline into structure so it survives contributors who have not read the whole codebase.
