# Site AGENTS.md conformance: audit + drift gate

- **Date:** 2026-06-18
- **Status:** design (approved; revised after planning-phase investigation)
- **Branch / worktree:** `worktree-chore+site-agents-conformance` (fresh off `main` after PR #119 merged)

## Goal

`apps/site` is the framework's own dogfood and de-facto reference app. The LLM
documentation program (PR #107) hands every agent the `AGENTS.md` contract that
prescribes how to use the framework idiomatically. This work makes the site and
the contract agree, so an agent that reads the docs and then reads our own code
sees the same idioms, not contradictions.

Conformance is **bidirectional**: where the code diverges from the contract,
usually the code is wrong and we fix it; but where the contract misstates the
framework, the contract is wrong and we fix that instead. The planning-phase
investigation found one of each kind (see Findings below).

Three workstreams:

- **Phase A (audit + fix):** a one-time pass that checks `apps/site` app code
  against the contract and fixes or consciously accepts each divergence. The
  concrete work is type-cast triage.
- **Phase B (drift gate):** a vitest test that mechanically enforces the
  checkable rules so the site cannot silently drift back out of conformance. It
  mirrors the two drift gates shipped in PR #107
  (`apps/site/src/pages/docs/__tests__/exports-coverage.test.ts`,
  `packages/create-hono-preact/__tests__/agents-appendix.test.ts`), including
  their "honest, commented allowlist" idiom.
- **Phase C (docs correction):** fix the one incorrect line in `AGENTS.md` and
  scan the docs corpus for the same contradiction.

## The contract

Source of truth: `packages/create-hono-preact/templates/agents/AGENTS.md`. The
checkable idioms it prescribes:

- Routes are declared in `src/routes.ts` via `defineRoutes` / `contentRoutes`;
  there is no file-system routing.
- This is Preact: hooks come from `preact/hooks`, never `react`.
- Server code lives only in colocated `*.server.ts` files, which export
  `serverLoaders` / `serverActions` (plus erased `export type`s); no default
  export.
- Data comes from `defineLoader`; mutations are `defineAction`s with the uniform
  `__outcome` envelope (`useActionResult` / `useFormStatus`).
- Do not cast; let route/loader inference work (`useParams()` is typed per route).
- Page guards are a single `use: [...]` array on a route node.
- Import only from the documented public subpaths (`hono-preact`,
  `hono-preact/page`, `hono-preact/server`, `hono-preact/vite`,
  `hono-preact/adapter-cloudflare`, `hono-preact/adapter-node`); UI comes from
  the separate `hono-preact-ui` package.

## Key principle: app code vs docs

The site holds two kinds of content, and they must be treated differently:

- **Application code** (`.ts` / `.tsx`): the dogfood app. This is what must
  follow the contract. Live `<Example>` `.tsx` components are app code too (they
  are idiomatic mini-demos, not anti-pattern snippets), so they are in scope.
- **Documentation content** (`.mdx`, and prose): the docs deliberately
  demonstrate escape hatches and "don't do this" patterns for teaching. For
  example, `pages/docs/optimistic-ui.mdx` imports `hono-preact/internal` on
  purpose and the prose explicitly warns it has no semver guarantee.

Therefore the audit and the gate target **app code only** and never read `.mdx`
bodies. (Phase C edits docs deliberately and separately.) This mirrors the
fence-aware corpus extraction lesson from the llms generator: documentation that
shows code is not the same as code.

## Findings from the planning investigation

These shaped the rule set; recorded so the rationale is not lost.

1. **Importing `serverLoaders` / `serverActions` from a `.server` file into
   client components is the intended, documented mechanism**, not a leak.
   `loaders.mdx` shows `import { serverLoaders } from './movies.server.js'`
   followed by `serverLoaders.default.useData()`; the Vite plugin rewrites that
   import into a client-safe RPC Proxy stub that POSTs to `/__loaders`. The demo
   does exactly this (`project-board.tsx`, `TaskCard.tsx`, `Board.tsx`,
   `NewTaskDialog.tsx`). A "no `.server` import in client code" rule would reject
   correct, idiomatic code. **The demo is right.**

2. **`AGENTS.md` line 30 is wrong.** It says *"Never import a `.server` symbol
   into client code,"* which contradicts finding 1 and the framework's own
   mechanism. An agent obeying it literally could not read loader data the
   documented way. **The contract is wrong** (Phase C fixes it).

3. **`.server.ts` export shape is already build-enforced.**
   `packages/vite/src/server-loader-validation.ts`
   (`serverLoaderValidationPlugin`) fails the build if a `.server.*` file has a
   default export, an `export *`, or any value named export other than
   `serverLoaders` / `serverActions`. It explicitly exempts `export type`
   (`server-loader-validation.ts:39`), which is why the demo's
   `export type BoardData` / `ShellData` are fine. A vitest gate for this would
   be pure duplication.

## Rule taxonomy

### Gated (mechanizable, ~zero false positives)

- **R1 - No `react` / `react-dom` imports.** Hooks and JSX come from Preact.
- **R2 - Framework imports stay on the public surface.** No import specifier
  that (a) contains `/internal`, or (b) starts with `@hono-preact/` (the internal
  workspace packages `iso` / `server` / `vite` / `ui`). The site must consume the
  published `hono-preact` and `hono-preact-ui` surface, not the internals.
- **R5 - No casts outside accepted boundaries.** Phase A reshapes every cast it
  can per the CLAUDE.md "type casts" guidance; the residue (genuine boundaries
  such as DOM API reads, Worker `MessageEvent.data`, untrusted-JSON parses) goes
  on a commented allowlist with a one-line reason each. Any cast not on the
  allowlist fails CI. Stale allowlist entries (a cast that no longer exists) also
  fail, so the list stays honest. `as const` is never a cast for this purpose.

### Not gated, by design

- **`.server.ts` export shape:** already enforced by `serverLoaderValidationPlugin`
  at build time (finding 3). Not re-gated.
- **Server/client import boundary:** importing `serverLoaders`/`serverActions`
  into client code is the intended mechanism (finding 1). There is no
  import-level leak rule to enforce; runtime safety is the Vite plugin's job. (If
  the site ever grew a `src/server/*` helper directory, a "client must not import
  `@/server/*`" rule would become worthwhile; it has none today, so YAGNI.)

### Audit-only (structural / idiomatic; spot-checked, not continuously gated)

Routes via `defineRoutes`/`contentRoutes`; guards as `use: []` arrays; data via
`defineLoader`; mutations via `defineAction` + `__outcome`; forms via
`Form`/`useActionResult`. Judgement calls where a continuous gate would produce
false positives that cost more than they catch. The audit spot-checks each; the
site already follows them.

## Current baseline (measured in this worktree, on merged `main`)

App code (`apps/site/src/**/*.{ts,tsx}`, excluding `.mdx` and `__tests__`):

- **R1:** 0 `react` imports. Clean; the gate locks it in.
- **R2:** 0 `/internal` imports and 0 `@hono-preact/*` imports. The only
  `/internal` reference is the deliberate teaching import in `optimistic-ui.mdx`,
  which is out of scope. Clean; the gate locks it in.
- **R5:** ~12 real `X as Type` assertions (a naive `\bas [A-Z]` regex over-counts
  badly: it catches `useRef<T>(`, `querySelectorAll<T>(`, `import { X as Y }`,
  and `<T>() =>` generics, none of which are casts - which is exactly why the
  gate must use an AST, not a regex). The real casts:
  - **Genuine boundaries (expected to land on the allowlist):**
    `cloneNode(true) as HTMLElement` and `e.currentTarget as HTMLElement`
    (use-board-drag), `e as PointerEvent` (TaskCard), `e.data as WorkerOutMsg`
    (HeroShader) and `e.data as WorkerInMsg` (shader-worker),
    `JSON.parse(raw) as CookiePayload` (session).
  - **Reshapeable (expected to be fixed):** `filter(Boolean) as User[]`
    (project-board.server - replace with a `(u): u is User =>` type predicate,
    the canonical CLAUDE.md example), `} as CommentData` (task.tsx - type the
    binding/return instead), and the picker cluster `v as TaskStatus` /
    `v as TaskPriority` in `components/demo/pickers.tsx` and
    `components/demo/TaskActions.tsx` (reshape by typing the generic
    Select/Combobox value so the union flows through).

The exact final partition (fixed vs allowlisted) is the audit's deliverable; the
checker built in Phase B is the tool that enumerates it precisely.

## Phase A: audit + fix

1. Run the R5 collector (built in Phase B) with an empty allowlist to enumerate
   every cast with file + expression.
2. For each: reshape away per CLAUDE.md (type predicate, typed binding, generic
   value type) **or** classify it as an accepted boundary. Reshape is strongly
   preferred; allowlisting is the fallback for genuine boundaries.
3. Spot-check the audit-only idioms and record findings.
4. The residue becomes the Phase B allowlist, one reason per entry.

Findings and dispositions live in the implementation plan and the PR
description, not a separate long-lived document.

## Phase B: the drift gate

- **Files:**
  - `apps/site/src/__tests__/agents-conformance-checker.ts` - the checker:
    parse a source file and collect its import specifiers, and its cast
    expressions. Pure functions over source text, no filesystem. (Lives under
    `__tests__` so the live scan excludes it and vitest does not collect it as a
    suite - the `include` glob only matches `*.test.{ts,tsx}`.)
  - `apps/site/src/__tests__/agents-conformance.test.ts` - the gate: the
    self-test fixtures (mutation check) + the live `apps/site/src` scan + the
    allowlist. Run by the root vitest project
    (`apps/site/src/**/__tests__/**/*.test.{ts,tsx}` is in `vitest.config.ts`'s
    `test.include`).
- **Anchoring:** resolve the scan root via `fileURLToPath(import.meta.url)` so it
  is cwd-independent (same idiom as `exports-coverage.test.ts`).
- **Scan set:** all `apps/site/src/**/*.{ts,tsx}`, **excluding** `**/*.mdx` and
  `**/__tests__/**` (the existing `exports-coverage` walker already skips
  `__tests__`; reuse that shape).
- **Parser:** `@babel/parser` + `@babel/types`, the repo's house AST tooling and
  exactly what `server-loader-validation.ts` uses (both are `apps/site` dev
  dependencies already). Parse each file with `sourceType: 'module'` and plugins
  `['typescript']` plus `'jsx'` for `.tsx`. AST parsing is what keeps R5 free of
  the regex false positives above and lets R1/R2 read real specifiers (including
  type-only and re-exports).
- **Per-rule checks:**
  - **R1 / R2:** collect specifiers from `ImportDeclaration`,
    `ExportNamedDeclaration` / `ExportAllDeclaration` with a `source`, and dynamic
    `import()` (a babel `ImportExpression`, whose `.source` carries the specifier
    - per the Babel 8 note). Assert none is `react` / `react-dom` (or a subpath),
    none contains `/internal`, none starts with `@hono-preact/`.
  - **R5:** collect every `TSAsExpression` and `TSTypeAssertion` whose asserted
    type is not `const`; assert each `{file, exprText}` is present in the
    allowlist; assert no allowlist entry is unused (stale).
- **Allowlist shape:** an in-file `const ALLOWLIST` array of
  `{ file, expr, reason }`, keyed by repo-relative file path plus the exact cast
  expression text (line numbers are intentionally not used: they drift). The
  block is commented as the single honest record of accepted boundaries.
- **Failure messages name the fix** (in the spirit of PR #107's error-legibility
  work): an R2 failure names the public subpath to use instead; an R5 failure
  says "reshape the type or add an allowlist entry with a reason."

## Phase C: docs correction

1. Reword `AGENTS.md` line 30. Replace the false *"Never import a `.server`
   symbol into client code"* with the accurate rule: client code imports
   `serverLoaders` / `serverActions` (the Vite plugin makes them client-safe RPC
   handles); never put secrets or server-only helpers where they would be inlined
   into the client - keep that logic inside the loader/action bodies in the
   `.server` file.
2. Scan the docs corpus (`apps/site/src/pages/docs/**/*.mdx`) for the same
   contradiction (any "never import .server" / "don't import server" phrasing)
   and fix it consistently.
3. Re-run the `agents-appendix` test (`packages/create-hono-preact/__tests__`) to
   confirm the AGENTS.md edit did not break the entry-point appendix invariant.

## Gate self-test

The gate ships with fixture-level coverage proving it fails when it should (a
mutation check, per the lesson that "a regression test that passes against
unmodified code proves nothing"): feed the checker small in-memory source strings
containing a `react` import, an `@hono-preact/iso` import, a `hono-preact/internal`
import, and an un-allowlisted cast, and assert each is reported; feed it a clean
source and a sole `as const` and assert nothing is reported.

## Workflow

- All work in this worktree; Serena indexes the main checkout, so use
  rg / Read / Edit here.
- This spec is committed under `docs/superpowers/specs/`.
- After plan: implement, then the six-step pre-push CI gate (build, format:check,
  typecheck, test, test:integration, site build), then open a PR to `main`.

## Non-goals

- Auditing or gating the scaffolder template app, other apps, or the framework
  packages themselves. Scope is `apps/site` (plus the Phase C `AGENTS.md` and
  docs-corpus edits).
- Re-gating `.server.ts` export shape (the build plugin owns it).
- The deferred PR #107 eval harness. Out of scope here.

## Risks / open questions

- **`as const` node shape.** Confirm during TDD how `@babel/parser` represents
  `x as const` (a `TSAsExpression` whose `typeAnnotation` references `const`) so
  R5 excludes it precisely.
- **Allowlist churn.** If the audit cannot reshape many casts, a large allowlist
  is a smell pointing back at the types. Prefer reshaping; treat a long allowlist
  as a finding, not a destination.
