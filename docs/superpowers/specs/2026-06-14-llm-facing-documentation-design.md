# LLM-facing documentation: helping any model use hono-preact correctly

**Date:** 2026-06-14
**Status:** Design approved, pending implementation plan

## Problem

hono-preact has good human docs (well-templated MDX, a three-pillar standard, a
validator hook) but no consumer-facing LLM enablement. There is no `llms.txt` on
the docs site, and the scaffolder (`create-hono-preact`) ships templates with a
`README.md` but no agent-guidance file. The repo `CLAUDE.md` is for people
working *on* the framework, not for consumers building *with* it.

The goal is to help any LLM use the framework correctly, agnostic to a particular
provider. "Correctly" matters specifically because the framework's shape is
unusual relative to what models pattern-match to (Next.js / Remix / React): a
confidently-wrong artifact is worse than none, because the model trusts it.

## Constraints and decisions

These were settled during brainstorming and drive the design:

- **Scope: a program across several surfaces**, sequenced by leverage-vs-cost,
  each phase independently shippable.
- **Source-of-truth strategy: hybrid (generate + enforce).** Generate the
  mechanical artifacts from sources the repo already trusts; hand-author the
  judgment parts; add CI gates that fail on drift, matching the repo's existing
  anti-drift culture (docs-template hook, client-size baseline, route↔nav parity).
- **Provider-agnostic.** Lean on cross-tool standards (`llms.txt`, `AGENTS.md`),
  not per-provider rules files.

## Architecture: one source-of-truth spine, many renderers

The drift-killer is refusing to hand-maintain parallel copies. Every mechanical
artifact is generated from the sources the site already trusts, at build time, in
`apps/site`.

```
sources (already exist)                renderers (new)
─────────────────────────             ─────────────────────────
docs/**/*.mdx  ──────────────┐
nav.ts (curated index) ──────┼──►  build step in apps/site  ──►  /llms.txt        (curated link index)
exports map + .d.ts ─────────┘                                ──►  /llms-full.txt   (full corpus)
                                                              ──►  exports-coverage check (CI)
```

Two existing facts make this cheap:

- `apps/site/src/pages/docs/nav.ts` is already a curated index (areas → sections
  → `{title, route}`), kept honest by an existing route↔nav parity test. That is
  exactly what `llms.txt` wants.
- The site already generates from source at build time (it reads the framework's
  `package.json` for the homepage version badge), so a generate step has
  precedent and a natural home (a Vite plugin / prebuild in `apps/site`).

The public surface enforced by the coverage check is the umbrella package's
`exports` map minus the `/internal*` subpaths: `.`, `./page`, `./server`,
`./vite`, `./adapter-cloudflare`, `./adapter-node`, plus the separate
`@hono-preact/ui` package.

### Phasing (each phase independently shippable)

1. **`llms.txt` + `llms-full.txt`** on the docs site. Cheapest, pure
   generate-from-MDX, immediate reach for chat/retrieval and doc-fetching agents.
2. **Scaffolder `AGENTS.md`** + an `add-agents` CLI command for existing
   projects + a CLI reference page + a Claude Code pointer + the exports-coverage
   test. Highest in-repo leverage.
3. **Framework-legibility pass.** Actionable error messages plus a few targeted
   guards, opportunistic.
4. *(optional capstone)* **Eval harness.** The only honest measure of "correctly."

## Artifacts

### 2a. `llms.txt` + `llms-full.txt`

**`llms.txt`** follows the llmstxt.org format: an H1 with the project name, a
blockquote summary, then H2 sections of annotated links. `nav.ts` maps straight
onto it: areas/sections become H2 groups; each `{title, route}` becomes
`[title](https://framework.sbesh.com/route): <one-line description>`. The
one-liner per page is the only new hand-authored text, and it lives next to the
page it describes (page frontmatter or a `description` field on the nav entry) so
it cannot drift from that page. A top-of-file link points at `/llms-full.txt`.

**`llms-full.txt`** is the concatenated corpus, pages in nav order. The one
non-trivial generator concern: MDX bodies contain JSX (`<Example>`,
`<CodeTabs>`). The generator must **unwrap the doc-component wrappers while
preserving their text and code-fence children**:

- an `<Example>`'s demo JSX becomes a `tsx` code fence (real usage the model can
  learn from),
- `<CodeTabs>` flattens to its labeled fences,
- prose and existing fences pass through; presentational wrappers vanish.

This keeps the corpus clean markdown instead of leaking component syntax.

Both files emit as static assets at the site root, resolving at
`framework.sbesh.com/llms.txt` and `/llms-full.txt` per the convention.

### 2b. Scaffolder `AGENTS.md`

The canonical, hand-authored in-repo guidance, shipped into **both** templates
(cloudflare and node). It is built around the conventions LLMs get *wrong* about
this framework specifically, because they pattern-match to Next/Remix/React:

| Assumption an LLM brings | What's actually true here |
|---|---|
| Routes come from a `pages/`/`app/` folder | Routes are **declared in code** in `src/routes.ts` (`defineRoutes` / `contentRoutes`) |
| It's React | It's **Preact**: import from `preact` / `preact/hooks` |
| Server code can sit in the component | Loaders/actions/guards live in colocated **`*.server.ts`** and never ship to the client |
| `getServerSideProps` / route handlers / `fetch` in `useEffect` | **`defineLoader`** for data; **actions + the `__outcome` envelope** for mutations (progressive-enhancement forms) |
| Cast to get types | Typed RPC end-to-end: `useParams`, typed loader data |
| Ad-hoc auth checks | Single-source **`use` guards** on route nodes |

Plus a short "where things go" (the four-file project shape), pointers to the
docs site and `llms.txt` / `llms-full.txt`, and a **generated API-surface
appendix** (the public `exports` subpaths) so the mechanical list cannot go
stale.

**Cross-tool reach without N copies:** `AGENTS.md` is canonical (Cursor, Codex,
Gemini read it natively). The template also ships a one-line `CLAUDE.md` pointing
at it. A `.github/copilot-instructions.md` pointer is a cheap optional add.

**Three install paths, one canonical `AGENTS.md`.** There are three ways a
developer reaches the framework, and each needs the guidance:

- **Scaffold a new app** (`create-hono-preact`): the template writes `AGENTS.md`
  on create. Already covered above.
- **Add to an existing project** (`pnpm add hono-preact`): nothing is written to
  the repo by an install (a `postinstall` that writes files is hostile and widely
  blocked). Instead, an explicit, opt-in command drops the same file in:
  `npx create-hono-preact add-agents` (writing `AGENTS.md` + the `CLAUDE.md`
  pointer into the current project, refusing to clobber an existing `AGENTS.md`
  without `--force`). It reuses the scaffolder's file-writing machinery and emits
  the *same* canonical `AGENTS.md` the template ships, so there is one source.
- **No repo at all** (chat / retrieval): the docs-site `llms.txt` / `llms-full.txt`
  cover this path.

**The enforce half:** an **exports-coverage test** enumerates each public entry
point's exports and fails CI if one is not documented in the corpus or the
AGENTS.md appendix. That is what makes "hybrid" real rather than aspirational.

### 2c. CLI reference page

The CLI is currently documented only inline in `quick-start.mdx` (the `create`
command and the `--adapter` flag); there is no reference page and no nav entry.
Adding the `add-agents` command makes a dedicated page worthwhile. A new
`docs/cli.mdx` (Infrastructure section in `nav.ts`) documents the full CLI
surface: `create-hono-preact` and its flags (`--adapter`, package-manager
detection, etc.) and the new `add-agents` command and its flags (`--force`). It
follows the existing Guide page template (prose + examples + an options table).

This page pays for itself twice. It documents the CLI for humans, and because
`llms-full.txt` generates from the MDX corpus, the CLI surface flows into the LLM
corpus automatically with no extra wiring.

### 2d. Framework-legibility pass (opportunistic)

The principle: an LLM that gets a precise error self-corrects without ever reading
docs. This is a bounded sweep, not a rewrite. Enumerate the framework's error
sites, pick the few highest-confusion ones (for example: importing a `.server`
symbol into client code; a route with a loader but no `.server.ts`; a missing
`<ClientScript>`), and make each error **name the file, name the fix, and link
the doc**. Each upgraded message gets a test. Scope is deliberately limited to the
top handful.

## Enforcement (the "enforce" in hybrid)

| Artifact | Generated from | Gate that fails CI on drift |
|---|---|---|
| `llms.txt` | `nav.ts` + per-page descriptions | every link resolves to a real page (reuses route↔nav parity) |
| `llms-full.txt` | MDX bodies, nav order | corpus non-empty; builds without unwrap errors |
| `AGENTS.md` appendix | public `exports` map | exports-coverage test: no undocumented public export |
| error messages | n/a (hand-written) | a unit test per upgraded message |

These run in the existing CI pipeline (`.github/workflows/ci.yml`), so they fail
locally before they fail in CI.

## Optional capstone: eval harness

The only honest measure of "correctly." A small fixtures set of natural-language
tasks (for example: "add a page with a loader that reads a query param", "add a
form that posts to an action"), each run through a model with the `AGENTS.md` plus
corpus as context, asserting the output **type-checks and passes a smoke test**.
Provider-agnostic by talking to any OpenAI-compatible or Anthropic endpoint behind
one thin interface. Deferred but designed-for: it is what tells us whether phases
1-3 moved the needle, and it can run on a cron rather than per-PR (it costs tokens
and is non-deterministic).

## Non-goals (explicit YAGNI)

- **No hosted MCP docs server.** Premature for a pre-1.0 framework that changes
  between minors; `llms.txt` covers the same provider-agnostic reach at a fraction
  of the maintenance.
- **No per-tool rules-file proliferation.** `AGENTS.md` is canonical; other tools
  get one-line pointers, not maintained copies.
- **No historical / migration breadcrumbs** in any artifact. This matches the
  repo's existing docs policy: describe what *is*, not what changed.

## Success criteria

1. Both repo install paths get the conventions without pasting: a fresh scaffold
   writes `AGENTS.md` on create, and `npx create-hono-preact add-agents` writes
   the same canonical file into an existing project. The CLI (both commands and
   all flags) is documented on the docs site.
2. `framework.sbesh.com/llms.txt` and `/llms-full.txt` exist and stay current
   automatically.
3. CI fails when a public export goes undocumented.
4. If the capstone ships, eval pass-rate is the tracked metric.
