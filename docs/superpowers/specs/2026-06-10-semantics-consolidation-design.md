# Semantics consolidation (Section A of the primitives DX review)

**Date:** 2026-06-10
**Status:** Approved design, pre-implementation
**Source:** Section A of `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`
**Goal:** The same semantics should have one implementation. Five duplication clusters collapse into shared modules across three PRs, with one deliberate behavior change (Form timeout handling) and otherwise byte-level behavior preservation.

## Scope decisions (locked with user)

1. **Three PRs by theme.** PR 1: outcome semantics (client envelope codec + server outcome translation). PR 2: server resolvers (route matcher + resolver-factory twins). PR 3: shared constants module. Release pressure is explicitly zero; no release work in scope.
2. **Unify accidental divergences, keep deliberate ones.** Form learns real timeout handling (behavior change, effectively a bug fix). Form keeps `window.location.reload()` on malformed bodies as an explicit progressive-enhancement policy. All server status codes and response shapes are unchanged.
3. **No public-surface changes.** `makePageUseResolvers` / `makePageActionResolvers` keep their exact signatures. Boundary redrawing is Section B work, not this.

## PR 1: Outcome semantics

### Client envelope codec (one decoder)

`packages/iso/src/internal/action-envelope.ts` already owns the `ActionEnvelope` wire type and the encoder `serializeActionOutcome`. It gains the decoder so the whole wire format lives in one file:

- `decodeActionResponse(res: Response): Promise<DecodedEnvelope>` parses the JSON body and validates the `__outcome` discriminant. Returns a discriminated union with kinds `success | redirect | deny | error | timeout | unknown | malformed`. `malformed` covers non-JSON and non-envelope bodies; `unknown` carries an unrecognized `__outcome` string (the two are distinct because both consumers treat them differently today). The decoder never throws for body-shape problems, the consumer decides.
- Cross-origin redirect detection (currently duplicated in both call sites) moves in as a shared helper.

Consumers become policy switches over `DecodedEnvelope`:

- `useAction` (`packages/iso/src/action.ts:405-478` today): behavior unchanged. `timeout` throws `TimeoutError(timeoutMs)`; `malformed` throws a parse error; unknown outcomes throw.
- `Form` (`packages/iso/src/form.tsx:95-159` today): `timeout` becomes a timeout-flavored error result with a message derived from `timeoutMs`, replacing today's `Unexpected outcome: timeout` fallthrough (the one behavior change). `malformed` keeps `window.location.reload()`, written as an explicit, commented PE-fallback policy.

### Server outcome translation (one module, four channels)

New `packages/server/src/outcome-translation.ts`. The four translation sites stay four channels because they genuinely produce different output (root HTML response, loader JSON, action envelope, action HTML/PE), but they are built from shared pieces in one file:

- Outcome-to-status mapping and redirect/deny shaping helpers.
- A single `rejectRenderOutcome()` helper owning the one copy of the "render outcome is page-scope only" defense, today pasted into three files (`render.tsx:70`, `loaders-handler.ts:180`, `action-envelope.ts:65`).
- `translateRootOutcome` (from `render.tsx:56-73`) and `translateOutcomeForLoader` (from `loaders-handler.ts:146-183`) move here.
- `page-action-handler.ts`'s HTML/PE branch (lines 318-390 today) calls the shared pieces in place.
- `serializeActionOutcome` stays in iso (the wire type's home) but delegates render rejection to the shared message constant.

### PR 1 tests

- Decoder unit tests: every outcome kind, malformed bodies (non-JSON, null, missing discriminant), cross-origin redirect.
- Existing Form/useAction tests stay green except the Form timeout case, updated to assert the new timeout error result.
- A test pinning the single render-rejection defense message.

## PR 2: Server resolvers

### One route matcher

New `packages/server/src/route-pattern.ts` holding the single copy of `segmentsOf`, `urlPathMatchesPattern`, and `patternScore`. The two existing copies (`route-server-modules.ts:23-65`, `page-action-resolvers.ts:47-72`) are byte-identical, so this is a pure move. The module also gains `findBestPattern(patterns, urlPath)` encapsulating the scan-and-score loop both factories inline today (specificity, then depth, then insertion order).

Deriving the matcher from preact-iso directly is not possible (preact-iso does not export its matcher); one well-tested mirror with the existing "mirrors preact-iso's literal-segment preference" comment is the practical ceiling.

### Merge the resolver-factory twins

New internal core `makeRouteModuleResolvers<T>` owning everything `makePageUseResolvers` (`route-server-modules.ts:119-231`) and `makePageActionResolvers` (`page-action-resolvers.ts:87-186`) share verbatim:

- Thunk cache with error recovery (failed loads evict so dev can retry).
- Dev-rebuild gating (`dev: true` bypasses cache per call).
- Outer-to-inner ancestor walk.
- `byPath` best-pattern scan via `findBestPattern`.
- ModuleKey reverse map.

Parameterized by a small strategy object: extract the payload from a loaded module (`pageUse` array vs `serverActions` via `extractActions`) and merge ancestor payloads (array concat vs Map with same-name shadowing). The two public factories become thin wrappers with their exact current signatures and return types.

### PR 2 tests

- The duplicated matcher coverage folds into one `route-pattern` test file.
- Direct core tests for cache-eviction-on-error and dev-rebuild (today tested only indirectly, twice).
- Existing resolver tests stay green unchanged; that is the behavior-preservation check.

## PR 3: Shared constants module

### Location

`packages/iso/src/internal/contract.ts`. iso is the bottom of the dependency graph; server already depends on it. vite gains a `@hono-preact/iso` workspace dependency: a new edge, but build-time only, importing only constants from a `sideEffects: false` package. A separate `@hono-preact/contract` package was considered and rejected as permanent release surface for a file of strings. Placing it in iso's internal tier lines up with Section B's planned split of `/internal` into a stable framework-emitted tier. `server-exports-contract.ts` stays in vite (all consumers are vite-side).

### Contents

One exported constant per literal, each with a doc comment naming every consumer:

- `/__loaders` (iso `internal/loader-fetch.ts`, vite `server-entry.ts` codegen, server `loaders-handler` mount docs).
- `static/client.js` and the URL form `/static/client.js` (vite `hono-preact.ts:82` entryFileNames, iso `client-script.tsx:5`).
- The virtual client id `virtual:hono-preact/client` and its dev-server URL `/@id/__x00__virtual:hono-preact/client`, with the URL derived from the id by a small helper rather than hand-encoded.
- `__moduleKey`, `__module`, `__action` field names (iso form/action, server page-action-handler, vite module-key plugin).
- The generated server-entry path (vite plugin constant).

vite's codegen interpolates constants into generated output; generated files stay self-contained and do not import the contract at runtime.

### Unimportable consumers

- The scaffolded `wrangler.jsonc` template cannot import TypeScript: create-hono-preact gets a parity test asserting the template's entry path equals the constant.
- The existing `__moduleKey` parity test simplifies to pinning wire behavior, since both sides now import the same constant.

### PR 3 tests

The parity tests above; otherwise mechanical substitution verified by the whole suite staying green.

## Error handling

- Decoder: body-shape problems are data (`malformed` / `unknown`), not throws; consumers own the failure policy. `unknown` keeps today's per-consumer behavior: Form produces an `Unexpected outcome: <value>` error result, useAction throws. `malformed` keeps Form's reload and useAction's parse-error throw.
- Resolver core: preserves the existing evict-on-failure cache semantics exactly; a load error still propagates to the caller after eviction.
- Translation module: unknown outcomes still produce the existing 500 responses per channel.

## Out of scope

- Moving resolver factories off the public `/server` entry, iso barrel re-export cleanup, `/internal` tier split (Section B).
- The six site-discovered primitives (Section C), vestigial-export trims (Section D), UI dedups (Section E).
- Any release work.

## Execution order

PR 1, then PR 2, then PR 3, each through the standard flow: implementation plan, build, the six-step local CI mirror, PR, deep review. PR 3 touches files PRs 1 and 2 create or move, so it goes last to avoid rebase churn.
