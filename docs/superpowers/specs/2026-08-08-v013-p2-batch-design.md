# v0.13 P2 batch: the five release-gating hardening fixes

**Date:** 2026-08-08
**Issues:** #335, #323, #332, #325, #322 (all P2; the only open issues left on milestone v0.13 after the tail moved to v0.14)
**Packaging:** one branch, one PR, five sequential fix-sized commits; `Closes #335 #323 #325 #332 #322`. All five were re-verified live against current `main` on 2026-08-08.

## #335: exhaustive export collection in the `.server.ts` whitelist

`packages/vite/src/server-loader-validation.ts` collects named exports only from `FunctionDeclaration` and `VariableDeclaration`, so `export class` (and `export enum`) silently bypass the whitelist. This is defense-in-depth (the `server-only.ts` import-site gate still blocks client access), but the file-level guard reports success on files it never checked.

Fix: replace the two-branch `if/else` with an exhaustive collector over `ExportNamedDeclaration.declaration`:

- `FunctionDeclaration` / `ClassDeclaration` / `TSEnumDeclaration` with an `id` push `id.name`.
- `VariableDeclaration` walks declarators (existing behavior).
- Type-only exports remain skipped via the existing `exportKind === 'type'` guard.
- Any other declaration node type fails the build loudly, naming the node type and the file, instead of silently passing. This is the acceptance criterion that outlives the class case: the next TS node type fails loud.

Tests: `export class` and `export enum` produce the same "may only export ..." error as `export const`; regression cases for function/const; the loud-failure arm exercised with an unhandled node type (e.g. `TSModuleDeclaration` via `export namespace`).

## #323: config-time guard on Vite `base`

A configured `base` silently 404s render-blocking route CSS (`route-preload.ts` hardcodes root-relative hrefs). Mirror the existing `cssCodeSplit` guard (`client-entry.ts`): a hard config-time error when `base` is set to anything other than `'/'` or `''`, same shape and message style, naming the route-CSS consequence and pointing at filing an issue if real `base` support is needed. Test sits alongside the `cssCodeSplit` guard test.

## #332: user-first handler composition + non-focusable trigger dev-warn (ui 0.4.0)

Two defects in `packages/ui/src/render-element.ts`:

- `mergeProps` unconditionally overwrites user props with framework props in its else-branch, so a handler on a render-prop vnode (`render={<button onClick={mine}/>}`) is silently dropped. Fix: when both sides hold a function for the same key, compose **user-first** (user handler runs, then the framework's), matching how part props already chain (`combobox.tsx`'s `onClick?.(event)`-then-own-work idiom). Non-function collisions keep current precedence.
- No warning when a `render` trigger resolves to a non-focusable element (keyboard access silently lost). Fix: a dev-only warning (stripped in production, matching the repo's existing dev-warn mechanism) in the ref path when the resolved element is non-focusable and has no `tabindex`.

Site fixes: both `TaskCard.tsx` span triggers (~:76 tooltip, ~:93 avatar badge) become focusable.

Tests: user handler fires alongside the part handler, user first; warn fires for a `span` trigger, not for a `button` or a `span` with explicit `tabindex`; the existing four render-element tests stay green.

## #325: cap and one-time warn the silent degrades

- `eventStream`'s FIFO (`packages/iso/src/event-stream.ts`) gets the ws-lifecycle treatment: `QUEUE_LIMIT = 128`, drop with a **one-time** `console.warn`, mirroring `internal/ws-lifecycle.ts`'s cap semantics (match its drop side). The docstring's "unbounded" contract line is updated; this is a documented-behavior change and is called out in the release notes.
- `createCache`'s ALS-absent fallback (`packages/iso/src/cache.ts`) gets a one-time boot warning when the module-global fallback store first engages.
- The font `Link` truncation bullet is **closed wontfix** on the issue: the code records the decision deliberately (`render.tsx` subtracts the font part from the closure's budget and comments why the font part itself is never truncated), and we are keeping it.

Tests: each degrade path warns exactly once (not once per event); the cap holds under overflow with a documented value.

## #322: deny-path parity and typing

The `DenyCode` vocabulary already shipped (#200/#210); this is plumbing plus one API reshape. Three gaps:

### Gap 1: loader deny envelope carries `code`

`translateOutcomeForLoader` (`packages/server/src/outcome-translation.ts`) emits `code` alongside `message`/`data` (action envelope parity: `action-envelope.ts` already does both). Client side, `loaderHttpError` (`packages/iso/src/internal/loader-fetch.ts`) reads `code` and `data` and throws a new exported `LoaderDenyError extends Error { status: number; code?: DenyCode; data?: unknown }` (parallel to `LoaderValidationError`), which reaches `errorFallback` like any loader error. The validation-issues carve-out is unchanged. Tests: server emit, client read, end-to-end code round-trip.

### Gap 2: `mutate()` gets a structural deny arm (BREAKING)

`MutateResult` becomes a three-arm union with a `kind` discriminant:

```ts
type MutateResult<TResult, TDenyData = unknown> =
  | { ok: true; data: Serialize<TResult> | undefined }
  | { ok: false; kind: 'deny'; deny: { status: number; message: string; code?: DenyCode; data?: TDenyData } }
  | { ok: false; kind: 'error'; error: Error };
```

The deny sink returns the typed arm instead of `throw new Error(message)`. Breaking for callers reading `result.error` on `ok:false`; recorded in the v0.13 release notes. This matches the repo's structural-variant idiom (loader-state ADT).

### Gap 3: `TDenyData`, inferred wherever possible

Primary path is inference, with explicit declaration as override and `unknown` as the fallback:

1. `DenyOutcome<TData = unknown>`; `deny()` gains generic overloads returning `DenyOutcome<TData>` inferred from the `data` argument.
2. `defineMiddleware` captures the type: the middleware `fn` return type becomes `Promise<void | Exclude<Outcome, DenyOutcome> | DenyOutcome<TData>>`, and `ServerMiddleware<S, TDeny = unknown>` gains a defaulted second param. The `Exclude` is load-bearing: without it `DenyOutcome<TData>` collapses into the union's untyped deny member and inference dies. The default keeps every existing declaration compiling.
3. `defineAction` infers from its `use` array via a distributive helper (`DenyOf<U> = U[number] extends ServerMiddleware<any, infer D> ? D : never`), yielding the union of the guards' deny-data types on the `ActionRef`, threaded through `UseActionOptions`, `MutateResult`, and `ActionResult`. Explicit `TDenyData` at `defineAction` overrides inference.
4. Before parameterizing, the three duplicated deny-record shapes (`use-action-result.ts`, `action-result-context.tsx`, `internal/action-result-store.ts`) are consolidated into one shared type.
5. `<Form>`'s sink and the shared `OutcomeSink` stay at `unknown` (no action type context at that call site); the wire decode in `action-envelope.ts` remains the one sanctioned assertion boundary.

**De-risk spike first.** The first task of #322 is a type-level spike (`.test-d.ts`) proving `deny → defineMiddleware → use array → ActionRef` inference end to end against the real types, before any plumbing changes. Decision rule, recorded here so it is not relitigated: if the spike shows TS cannot hold the inference (e.g. the `Exclude` trick fails under the real union, or the `use`-array distribution loses the type), fall back to declared-with-default (`TDenyData = unknown` specified at `defineAction`), keep `deny()` generic regardless, and note the fallback in the PR.

**Constraints and caveats (into docs and release notes):**

- Guards attached at route/app level are invisible to the action-level inference; their denials surface under the `unknown` fallback.
- The wire boundary asserts, not validates: `TDenyData` has exactly the honesty of `TResult`. This deliberately matches existing semantics and does not pre-empt #314.
- Regression risk: the #359 bivariance fix (indexed-access `ServerMiddleware` shape) must survive the added type param, pinned by `test-d` assertions.
- Shared `Outcome` and the middleware dispatcher stay unparameterized; a typed deny upcasts safely to `unknown` through them. No casts anywhere in the thread.
- New `.test-d.ts` coverage for the whole deny thread (none exists today).

## Testing and mechanics

- TDD per fix; each issue's acceptance criteria become named tests. Mutation-check warnings-fire-once tests (break the once-guard, watch it fail).
- Worktree off `origin/main`; subagent-driven execution; nine-step pre-push verification; single PR; deep review after opening.
- Docs: deny typing in the actions/validation docs pages; `eventStream` cap on its page; `LoaderDenyError` in the loaders/deny docs. Release-notes fragments for the two breaking/behavior changes (`MutateResult` shape, `eventStream` cap).
- Out of scope: real Vite `base` support; the font `Link` budget (wontfix); #314's validation question; any route/app-level deny inference.
