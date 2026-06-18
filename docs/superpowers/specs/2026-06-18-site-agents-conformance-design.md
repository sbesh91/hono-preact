# Site AGENTS.md conformance: audit + drift gate

- **Date:** 2026-06-18
- **Status:** design (approved in brainstorming; awaiting written-spec review)
- **Branch / worktree:** `worktree-chore+site-agents-conformance` (fresh off `main` after PR #119 merged)

## Goal

`apps/site` is the framework's own dogfood and de-facto reference app. The LLM
documentation program (PR #107) hands every agent the `AGENTS.md` contract that
prescribes how to use the framework idiomatically. This work makes `apps/site`
faithfully embody that contract, so an agent that reads the docs and then reads
our own code sees the same idioms, not contradictions.

Two phases:

- **Phase A (audit + fix):** a one-time pass that checks `apps/site` against the
  contract and fixes or consciously accepts each divergence.
- **Phase B (drift gate):** a vitest test that mechanically enforces the
  checkable rules so the site cannot silently drift back out of conformance. It
  mirrors the two drift gates already shipped in PR #107
  (`apps/site/src/pages/docs/__tests__/exports-coverage.test.ts`,
  `packages/create-hono-preact/__tests__/agents-appendix.test.ts`), including
  their "honest, commented allowlist" idiom.

## The contract

Source of truth: `packages/create-hono-preact/templates/agents/AGENTS.md`. The
checkable idioms it prescribes:

- Routes are declared in `src/routes.ts` via `defineRoutes` / `contentRoutes`;
  there is no file-system routing.
- This is Preact: hooks come from `preact/hooks`, never `react`.
- Server code lives only in colocated `*.server.ts` files, which export **only**
  `serverLoaders` / `serverActions` (no default export) and are never imported
  into client code.
- Data comes from `defineLoader`; mutations are `defineAction`s and results come
  back in the uniform `__outcome` envelope (`useActionResult` / `useFormStatus`).
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
bodies. This mirrors the fence-aware corpus extraction lesson from the llms
generator: documentation that shows code is not the same as code.

## Rule taxonomy

### Gated (mechanizable, ~zero false positives)

- **R1 - No `react` / `react-dom` imports.** Hooks and JSX come from Preact.
- **R2 - Framework imports stay on the public surface.** No import specifier
  that (a) contains `/internal`, or (b) starts with `@hono-preact/` (the internal
  workspace packages `iso` / `server` / `vite` / `ui`). The site must consume the
  published `hono-preact` and `hono-preact-ui` surface, not the internals.
- **R3 - `.server.ts` export shape.** A `*.server.ts` file may export only
  `serverLoaders` and/or `serverActions`, and must have no default export.
- **R4 - No server leak.** No client (non-`.server`) module may import a
  `*.server.ts` / `*.server.tsx` module.

### Gated with an honest, commented allowlist

- **R5 - No casts outside accepted boundaries.** Phase A reshapes every cast it
  can per the CLAUDE.md "type casts" guidance; the residue (genuine boundaries
  such as FormData reads, untrusted-JSON parses, user-module structural reads)
  goes on a commented allowlist with a one-line reason each. Any cast not on the
  allowlist fails CI. Stale allowlist entries (a cast that no longer exists) also
  fail, so the list stays honest. `as const` is never a cast for this purpose.

### Audit-only (structural / idiomatic; not continuously gated)

Routes via `defineRoutes`/`contentRoutes`; guards as `use: []` arrays; data via
`defineLoader`; mutations via `defineAction` + `__outcome`; forms via
`Form`/`useActionResult` rather than ad-hoc `fetch`. These are judgement calls
where a continuous gate would produce false positives that cost more than they
catch. The audit spot-checks each and records the result; the site already
follows them.

## Current baseline (measured in this worktree, on merged `main`)

App code (`apps/site/src/**/*.{ts,tsx}`, excluding `.mdx`):

- **R1:** 0 `react` imports. Already clean.
- **R2:** 0 `/internal` imports and 0 `@hono-preact/*` imports in app code. The
  only `/internal` reference is the deliberate teaching import in
  `optimistic-ui.mdx`, which is out of scope. Already clean.
- **R3 / R4:** 4 `.server.ts` files (`login`, `project-board`, `projects-shell`,
  `task` under `pages/demo/`) to verify.
- **R5:** ~14 casts in non-test app code (excluding `as const`), concentrated in
  `components/demo` (6), with the rest spread across `pages/demo`, `hooks`,
  `components`, `pages/docs`, `demo`. This is the real work of Phase A; the audit
  enumerates the exact list and dispositions each.

So R1, R2, and R4 are expected to pass on day one (the gate locks them in); R3 is
a quick verification; R5 is where the audit spends its effort.

## Phase A: audit + fix

1. Enumerate every cast in non-test app code with file, expression, and context.
2. For each: reshape away per CLAUDE.md (declare the symbol key, write a type
   predicate, widen the source field, fix the generic) **or** classify it as an
   accepted boundary and record the reason. Reshape is strongly preferred;
   allowlisting is the fallback for genuine boundaries.
3. Verify R3 on the 4 `.server.ts` files and R4 across all client imports.
4. Spot-check the audit-only idioms and record findings.
5. Produce the allowlist that Phase B's gate consumes, with a reason per entry.

The audit's findings and dispositions live in the implementation plan and the
final PR description, not in a separate long-lived document.

## Phase B: the drift gate

- **Location:** `apps/site/src/__tests__/agents-conformance.test.ts`, run by the
  site's existing vitest project (part of `pnpm test`). It anchors its scan to
  the repo via `fileURLToPath(import.meta.url)` so it is cwd-independent.
- **Scan set:** all `apps/site/src/**/*.{ts,tsx}`, **excluding** `**/*.mdx` and
  `**/__tests__/**`.
- **Parser:** the TypeScript compiler API (`typescript` is already a dependency),
  not regex. Each file is parsed to a `SourceFile` and walked once. AST parsing
  is what keeps R5 free of the false positives a `\bas [A-Z]` regex would
  produce (identifiers like `markdownAs`, multi-line casts, `as const`) and lets
  R1/R2/R4 see real import specifiers (including type-only and re-exports) rather
  than guessing from text.
- **Per-rule checks:**
  - R1 / R2: walk `ImportDeclaration` / `ExportDeclaration` / dynamic
    `import()` module specifiers; assert none is `react`/`react-dom`, contains
    `/internal`, or starts with `@hono-preact/`.
  - R3: for files matching `*.server.ts`, walk top-level exports; assert the set
    of exported names is a subset of `{serverLoaders, serverActions}` and there
    is no default export.
  - R4: for non-server files, assert no import specifier resolves to a
    `*.server.{ts,tsx}` module.
  - R5: collect every `AsExpression` (and `<T>x` angle-bracket assertion) whose
    target type is not `const`; assert each `{file, exprText}` is present in the
    allowlist; assert no allowlist entry is unused (stale).
- **Allowlist shape:** an in-file `const ALLOWLIST` array of
  `{ file, expr, reason }`, keyed by repo-relative file path plus the exact
  cast expression text (line numbers are intentionally not used: they drift).
  The block is commented as the single honest record of accepted boundaries.
- **Failure messages name the fix**, in the spirit of PR #107's error-legibility
  work: an R2 failure says which public subpath to use instead; an R5 failure
  says "reshape the type or add an allowlist entry with a reason"; an R3 failure
  names the only allowed exports.

## Gate self-test

The gate test ships with fixture-level coverage proving it actually fails when it
should (a mutation check, per the lesson that "a regression test that passes
against unmodified code proves nothing"): feed the checker a small in-memory
source string containing a `react` import, an `@hono-preact/iso` import, a
`.server.ts` with a default export, a client file importing a `.server` module,
and an un-allowlisted cast, and assert each is reported. This keeps the checker
honest independently of the live `apps/site` tree.

## Workflow

- All work in this worktree; Serena indexes the main checkout, so use
  rg / Read / Edit here.
- This spec is committed under `docs/superpowers/specs/`.
- After spec review: `writing-plans` produces the implementation plan, then
  implement, then the six-step pre-push CI gate (build, format:check, typecheck,
  test, test:integration, site build), then open a PR to `main`.

## Non-goals

- Auditing or gating the scaffolder template output, other apps, or the framework
  packages themselves. Scope is `apps/site`.
- Gating `.mdx` documentation content.
- The deferred PR #107 eval harness (measuring whether an LLM uses the framework
  correctly end to end). Out of scope here.

## Risks / open questions

- **Module resolution for R4.** Resolving an import specifier to a concrete
  `*.server` file path is the fiddliest part (relative specifiers, path aliases).
  The plan should confirm the site's alias setup and keep R4's resolver simple
  and explicit rather than reimplementing a full resolver.
- **`typescript` availability in the site's test project.** Confirm the gate can
  `import ts from 'typescript'` under the site's vitest config; if not, add it as
  a devDependency to the site package.
- **Allowlist churn.** If the audit cannot reshape many casts, a large allowlist
  is a smell pointing back at the types. Prefer reshaping; treat a long allowlist
  as a finding, not a destination.
