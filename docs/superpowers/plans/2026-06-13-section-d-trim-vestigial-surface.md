# Section D: Trim Vestigial Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove or correct seven pieces of vestigial / orphaned / mislabeled public surface across iso, server, vite, the scaffolder, templates, docs, and ui, in one cleanup-sweep PR.

**Architecture:** Each item is an independent removal/demotion/rename. No item depends on another, so tasks may run in any order. The cross-package backstop for "nothing still references the removed surface" is `pnpm typecheck` + `pnpm test:coverage`; per item, the specific tests that asserted the old surface are updated or deleted.

**Tech Stack:** TypeScript, Preact, preact-iso, Vite plugins (oxc/acorn AST), Vitest, the `create-hono-preact` Node CLI.

**Spec:** `docs/superpowers/specs/2026-06-13-section-d-trim-vestigial-surface-design.md`

---

## Background an implementer needs

- **Breaking is free:** everything here is unreleased, so removing/renaming public exports needs no deprecation. Just remove.
- **Removals are TDD-inverted:** for a removal, the regression oracle is `pnpm typecheck` (catches any dangling reference) plus the existing suite (catches broken consumers). Each task: make the edit, update/delete the tests that asserted the removed surface, then run typecheck + the relevant suite to confirm green. Do NOT leave a test asserting surface you removed.
- **Test command (from repo root):** `pnpm exec vitest run <path>` for a single file; `pnpm --filter <pkg> exec vitest run` for a package. Build the framework dist first when typechecking apps/site or running cross-package: `pnpm --filter '@hono-preact/*' --filter hono-preact build`.
- **Branch safety (subagent rule):** before any commit, run `git branch --show-current` and confirm it is the feature branch, never `main`.
- **No em-dashes** in prose, comments, or commit messages.
- **The terminal sometimes renders matched search tokens oddly** (e.g. showing `ln`); trust the file contents via Read, not a grep's echoed match text.

## File Structure

| Item | Files touched |
|---|---|
| 1. useRouteChange | `packages/iso/src/route-change.ts` (delete), `packages/iso/src/index.ts`, `packages/iso/src/internal.ts`, `packages/iso/src/internal/route-change.ts`, `apps/site/src/pages/demo/project-layout.tsx` |
| 2. /__actions | `packages/vite/src/server-entry.ts`, `packages/iso/src/internal/contract.ts`, `packages/vite/src/module-key.ts`, both template `api.ts`, `packages/vite/src/__tests__/server-entry.test.ts` |
| 3. loaderUse/actionUse | `packages/vite/src/server-exports-contract.ts`, `server-loaders-parser.ts`, `server-loader-validation.ts`, `server-only.ts`, + 3 test files |
| 4. env demote | `packages/iso/src/index.ts`, `packages/iso/src/internal-runtime.ts`, `packages/vite/src/server-entry.ts`, `packages/vite/src/__tests__/server-entry.test.ts`, `apps/site/src/pages/docs/structure.mdx` |
| 5. noop.tsx | `apps/site/src/pages/noop.tsx` (delete) |
| 6. scaffolder version | `packages/create-hono-preact/lib/cli.mjs`, `packages/create-hono-preact/__tests__/cli.test.ts` |
| 7. useRender rename | `packages/ui/src/use-render.ts`, `packages/ui/src/index.ts`, ~8 component files |

---

## Task 1: Remove `useRouteChange`, collapse the legacy route-change slot

**Files:**
- Delete: `packages/iso/src/route-change.ts`
- Modify: `packages/iso/src/index.ts` (lines 138-139), `packages/iso/src/internal.ts` (line 50), `packages/iso/src/internal/route-change.ts`, `apps/site/src/pages/demo/project-layout.tsx`

- [ ] **Step 1: Migrate the site consumer.** In `apps/site/src/pages/demo/project-layout.tsx`, change the import on line 2 from:

```tsx
import { useParams, useRouteChange, ViewTransitionName } from 'hono-preact';
```

to:

```tsx
import { useParams, useViewTransitionLifecycle, ViewTransitionName } from 'hono-preact';
```

and replace the `useRouteChange(...)` call (lines 9-11):

```tsx
  useRouteChange(() => {
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  });
```

with:

```tsx
  useViewTransitionLifecycle({
    onAfterSwap: () => {
      if (typeof window !== 'undefined') window.scrollTo(0, 0);
    },
  });
```

- [ ] **Step 2: Delete the public wrapper.** `git rm packages/iso/src/route-change.ts`. Then remove its barrel exports in `packages/iso/src/index.ts` (delete both lines):

```ts
export { useRouteChange } from './route-change.js';
export type { RouteChangeHandler } from './route-change.js';
```

- [ ] **Step 3: Collapse the legacy slot** in `packages/iso/src/internal/route-change.ts`. Remove:
  - the `LegacySub` type (line 15): `type LegacySub = (to: string, from: string | undefined) => void;`
  - the registry (line 24): `const legacySubs = new Set<LegacySub>();`
  - the `__subscribeRouteChange` function (lines 33-37, the `export function __subscribeRouteChange(sub: LegacySub): () => void { legacySubs.add(sub); return () => { legacySubs.delete(sub); }; }`)
  - the `fireLegacy` function (lines 40-42)
  - the `fireLegacy(event.to, event.from);` call inside `fireAfterSwap` (line 125) and its preceding comment lines about legacy subscribers.

  Leave `phaseSubs`, `__subscribePhase`, `installNavTransitionScheduler`, and all `fireAfterSwap`/`fireAfterTransition` phase logic intact (they back `useViewTransitionLifecycle`).

- [ ] **Step 4: Remove the internal re-export.** In `packages/iso/src/internal.ts`, delete line 50:

```ts
export { __subscribeRouteChange } from './internal/route-change.js';
```

- [ ] **Step 5: Confirm no dangling references and no orphaned test.**

Run: `rg -n 'useRouteChange|__subscribeRouteChange|RouteChangeHandler|fireLegacy|legacySubs|LegacySub' packages/ apps/ --glob '!**/dist/**'`
Expected: zero matches. If a dedicated `route-change.test.ts` exists asserting `useRouteChange`, `git rm` it (the behavior now lives in the view-transition-lifecycle tests).

- [ ] **Step 6: Build + typecheck + run the iso suite.**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck`
Expected: clean (no missing-export errors in apps/site, which no longer imports `useRouteChange`).
Run: `pnpm --filter @hono-preact/iso exec vitest run`
Expected: pass (view-transition-lifecycle tests still green; `onAfterSwap` unaffected).

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "refactor(iso): remove useRouteChange, collapse legacy route-change slot"
```

---

## Task 2: Remove the dead `/__actions` reservation

**Files:**
- Modify: `packages/vite/src/server-entry.ts`, `packages/iso/src/internal/contract.ts`, `packages/vite/src/module-key.ts`, `packages/create-hono-preact/templates/node/src/api.ts`, `packages/create-hono-preact/templates/cloudflare/src/api.ts`, `packages/vite/src/__tests__/server-entry.test.ts`

- [ ] **Step 1: Drop `/__actions` from `RESERVED_PATHS`** in `packages/vite/src/server-entry.ts` (~line 98). Change:

```ts
const RESERVED_PATHS = new Set([LOADERS_RPC_PATH, '/__actions']); // '/__actions' stays literal; slated for removal (see iso internal/contract.ts)
```

to:

```ts
const RESERVED_PATHS = new Set([LOADERS_RPC_PATH]);
```

- [ ] **Step 2: Fix the error-message string** in the same file (~line 383). Change the fragment:

```ts
            `(/__loaders, /__actions) and the SSR handler, so these routes break ` +
```

to:

```ts
            `(/__loaders) and the SSR handler, so these routes break ` +
```

- [ ] **Step 3: Remove the contract note.** In `packages/iso/src/internal/contract.ts`, delete the comment line (~line 8) that says the `/__actions` reserved path stays a literal. Read the file first to get the exact surrounding lines; remove only the `/__actions`-specific sentence, keep the rest of the comment block coherent.

- [ ] **Step 4: Fix the module-key comment.** In `packages/vite/src/module-key.ts` (~line 9), change the comment mentioning `` `__loaders`/`__actions` RPC `` to reference only `` `__loaders` RPC ``.

- [ ] **Step 5: Fix the template comments.** In both `packages/create-hono-preact/templates/node/src/api.ts` and `packages/create-hono-preact/templates/cloudflare/src/api.ts` (~line 4), change the comment `mounts this app ahead of its reserved /__loaders and /__actions paths` to `mounts this app ahead of its reserved /__loaders path`.

- [ ] **Step 6: Update the server-entry test.** In `packages/vite/src/__tests__/server-entry.test.ts`, find any assertion that `RESERVED_PATHS` (or the generated reserved-path behavior / error message) includes `/__actions` and remove the `/__actions` expectation. Run `rg -n '__actions' packages/vite/src/__tests__/` to find them; update each to expect only `/__loaders`.

- [ ] **Step 7: Verify + commit.**

Run: `rg -n '__actions' packages/ --glob '!**/dist/**'`
Expected: zero matches.
Run: `pnpm --filter @hono-preact/vite exec vitest run`
Expected: pass.

```bash
git add -A
git commit -m "refactor(vite): remove dead /__actions reserved path"
```

---

## Task 3: Remove the `loaderUse`/`actionUse` convention and its dead machinery

Traced blast radius: `findUseExports` is consumed only by the validation plugin (no server-side wiring ever runs these arrays), and `hasNamedUseExport` is used only by tests. The whole concept is dead surface.

**Files:**
- Modify: `packages/vite/src/server-exports-contract.ts`, `packages/vite/src/server-loaders-parser.ts`, `packages/vite/src/server-loader-validation.ts`, `packages/vite/src/server-only.ts`
- Modify (tests): `packages/vite/src/__tests__/server-loaders-parser.test.ts`, `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`, `packages/vite/src/__tests__/server-only-plugin.test.ts`

- [ ] **Step 1: Trim the contract.** In `packages/vite/src/server-exports-contract.ts`:
  - Remove `'loaderUse'` and `'actionUse'` from `RECOGNIZED_SERVER_EXPORTS` (leaving `['serverActions', 'serverLoaders']`).
  - Delete `RECOGNIZED_USE_EXPORTS`, `RecognizedUseExport`, and `RECOGNIZED_USE_EXPORTS_SET` entirely.
  - Rewrite the status comment block (the `// - loaderUse / actionUse: reserved names ...` bullet) to drop the loaderUse/actionUse paragraph; keep the `serverLoaders`/`serverActions` description.

- [ ] **Step 2: Strip the parser.** In `packages/vite/src/server-loaders-parser.ts`, delete: the `RECOGNIZED_USE_EXPORTS` import + re-export (lines 7, 13-14), `hasNamedUseExport` (line 16), the `ParsedUseExport` type (line 30), and `findUseExports` (line 44). Keep `parseServerLoaders` and everything else.

- [ ] **Step 3: Strip the validation.** In `packages/vite/src/server-loader-validation.ts`, remove the `import { findUseExports } from './server-loaders-parser.js';` (line 9) and the entire F3 validation block (the `for (const useExport of findUseExports(ast.program)) { ... }` loop and its leading `// F3:` comment, ~lines 64-100). Read the file to get the exact block boundaries; ensure the surrounding validation logic (other checks) stays intact and the function still returns/continues correctly.

- [ ] **Step 4: Strip the server-only client stub.** In `packages/vite/src/server-only.ts`, remove the `RECOGNIZED_USE_EXPORTS_SET` import (line 18) and the `else if` branch that stubs use-exports (the `else if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier' && RECOGNIZED_USE_EXPORTS_SET.has(specifier.imported.name)) { ... stubs.push(\`const ${specifier.local.name} = [];\`); }` block, ~lines 251-260). Verify the `if/else if` chain remains syntactically valid after removal (the next `else if` becomes part of the chain).

- [ ] **Step 5: Update the parser tests.** In `packages/vite/src/__tests__/server-loaders-parser.test.ts`, remove the imports of `hasNamedUseExport` and `findUseExports` and delete their `describe`/`it` blocks (the `hasNamedUseExport` cases and the `describe('findUseExports', ...)` block). Keep the `parseServerLoaders` tests, including the one asserting a sibling `loaderUse`/`actionUse` export is ignored (that behavior is now "unknown export", so if that specific test asserts recognition, remove it; if it asserts `parseServerLoaders` ignores siblings, keep it as-is since `parseServerLoaders` still ignores non-loader exports).

- [ ] **Step 6: Update the validation-plugin tests.** In `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`, remove the F3/F11 `loaderUse`/`actionUse` cases (the `accepts loaderUse = identifier`, `accepts actionUse = ...`, `accepts loaderUse = [..]`, `rejects loaderUse = {object}`, `rejects loaderUse = 42`, `rejects loaderUse = "foo"` blocks). Update the recognized-exports error-list assertion `/'serverActions'.*'serverLoaders'.*'loaderUse'.*'actionUse'/` to `/'serverActions'.*'serverLoaders'/` (and adjust any `expect(error).toContain("'loaderUse'")` lines by removing them).

- [ ] **Step 7: Update the server-only-plugin test.** In `packages/vite/src/__tests__/server-only-plugin.test.ts`, remove the `it('stubs loaderUse and actionUse imports too', ...)` test and any assertion expecting the error/stub to mention `loaderUse`/`actionUse`.

- [ ] **Step 8: Verify no dangling references.**

Run: `rg -n 'loaderUse|actionUse|findUseExports|hasNamedUseExport|RECOGNIZED_USE_EXPORTS|ParsedUseExport|RecognizedUseExport' packages/vite --glob '!**/dist/**'`
Expected: zero matches. (The only surviving `actionUse` in the repo is the unrelated local destructure in `packages/server/src/page-action-handler.ts`, which this task does not touch.)

- [ ] **Step 9: Build + typecheck + vite suite, then commit.**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck`
Expected: clean.
Run: `pnpm --filter @hono-preact/vite exec vitest run`
Expected: pass.

```bash
git add -A
git commit -m "refactor(vite): remove loaderUse/actionUse export convention and its dead machinery"
```

---

## Task 4: Demote the mutable `env` export to internal

**Files:**
- Modify: `packages/iso/src/index.ts` (line 135), `packages/iso/src/internal-runtime.ts`, `packages/vite/src/server-entry.ts`, `packages/vite/src/__tests__/server-entry.test.ts`, `apps/site/src/pages/docs/structure.mdx`

- [ ] **Step 1: Drop `env` from the public barrel.** In `packages/iso/src/index.ts` line 135, change:

```ts
export { isBrowser, env } from './is-browser.js';
```

to:

```ts
export { isBrowser } from './is-browser.js';
```

- [ ] **Step 2: Add `env` to the internal/runtime door.** In `packages/iso/src/internal-runtime.ts`, add (after the existing exports, before or after `export * from './internal/contract.js';`):

```ts
export { env } from './is-browser.js';
```

- [ ] **Step 3: Update the codegen.** In `packages/vite/src/server-entry.ts`, change the generated import line (~line 40) from:

```ts
    `import { Routes, env } from 'hono-preact';\n` +
```

to (two lines):

```ts
    `import { Routes } from 'hono-preact';\n` +
    `import { env } from 'hono-preact/internal/runtime';\n` +
```

The `env.current = 'server';` line later in the template is unchanged.

- [ ] **Step 4: Update the server-entry test.** In `packages/vite/src/__tests__/server-entry.test.ts` (~line 99), change:

```ts
    expect(src).toContain(`import { Routes, env } from 'hono-preact';`);
```

to:

```ts
    expect(src).toContain(`import { Routes } from 'hono-preact';`);
    expect(src).toContain(`import { env } from 'hono-preact/internal/runtime';`);
```

- [ ] **Step 5: Update the docs.** In `apps/site/src/pages/docs/structure.mdx` (~line 65), remove `` `env`, `` from the Utilities list. Change:

```md
- **Utilities**: `prefetch`, `isBrowser`, `env`, `Route`/`Router`/`lazy` (re-exports of preact-iso for advanced use).
```

to:

```md
- **Utilities**: `prefetch`, `isBrowser`, `Route`/`Router`/`lazy` (re-exports of preact-iso for advanced use).
```

- [ ] **Step 6: Verify + build + typecheck + commit.**

Run: `rg -n "\benv\b" packages/iso/src/index.ts` -> should no longer match (only `isBrowser` exported on that line).
Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck`
Expected: clean.
Run: `pnpm --filter @hono-preact/vite exec vitest run packages/vite/src/__tests__/server-entry.test.ts`
Expected: pass.

```bash
git add -A
git commit -m "refactor(iso): demote mutable env export to internal/runtime"
```

---

## Task 5: Delete the orphaned `noop.tsx`

**Files:**
- Delete: `apps/site/src/pages/noop.tsx`

- [ ] **Step 1: Confirm it is orphaned.**

Run: `rg -n 'noop' apps/site/src/routes.ts; rg -rn "pages/noop" apps/site/src --glob '!**/dist/**'`
Expected: no import of `noop.tsx` anywhere (the only `noop` hits are inside the file itself or unrelated `noopener` rel attributes).

- [ ] **Step 2: Delete and verify the site still builds.**

```bash
git rm apps/site/src/pages/noop.tsx
```

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck && pnpm --filter site build`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git commit -m "chore(site): delete orphaned noop.tsx"
```

---

## Task 6: Fix the scaffolder version string

**Files:**
- Modify: `packages/create-hono-preact/lib/cli.mjs`, `packages/create-hono-preact/__tests__/cli.test.ts`

- [ ] **Step 1: Read the version from package.json.** In `packages/create-hono-preact/lib/cli.mjs`, add `readFileSync` to the node:fs import (it currently imports only from `node:fs/promises`). Add near the top imports:

```js
import { readFileSync } from 'node:fs';
```

Then replace the hardcoded version handler (lines 37-40):

```js
  if (parsed.kind === 'version') {
    console.log('create-hono-preact 0.1.0');
    return 0;
  }
```

with (reads the package's own version; `here` = `dirname(fileURLToPath(import.meta.url))` already exists in the file, and `package.json` is one level up from `lib/`):

```js
  if (parsed.kind === 'version') {
    const { version } = JSON.parse(
      readFileSync(resolve(here, '..', 'package.json'), 'utf8')
    );
    console.log(`create-hono-preact ${version}`);
    return 0;
  }
```

- [ ] **Step 2: Tighten the test to the real version** (the existing regex `/create-hono-preact\s+\d+\.\d+\.\d+/` matched even the stale `0.1.0`, so it never caught the bug). In `packages/create-hono-preact/__tests__/cli.test.ts`, the `--version` test (~lines 348-359): add a read of the package version at the top of the test and assert exact output. Replace:

```ts
      expect(lines.join(' ')).toMatch(/create-hono-preact\s+\d+\.\d+\.\d+/);
```

with:

```ts
      const { version } = JSON.parse(
        readFileSync(
          new URL('../package.json', import.meta.url),
          'utf8'
        )
      );
      expect(lines.join(' ')).toBe(`create-hono-preact ${version}`);
```

Add `import { readFileSync } from 'node:fs';` to the test file's imports if not already present.

- [ ] **Step 3: Run the cli test + commit.**

Run: `pnpm --filter create-hono-preact exec vitest run packages/create-hono-preact/__tests__/cli.test.ts`
Expected: pass (the `--version` output now equals `create-hono-preact <real version>`).

```bash
git add -A
git commit -m "fix(create-hono-preact): print real version from package.json, not hardcoded 0.1.0"
```

---

## Task 7: Rename `useRender` -> `renderElement` (ui)

`useRender` (`packages/ui/src/use-render.ts`) is a pure function (no hooks; conditional early return in its body), so the `use` prefix mislabels it. Rename it; keep the public `RenderProp` type name.

**Files:**
- Modify: `packages/ui/src/use-render.ts`, `packages/ui/src/index.ts`, and all call sites (`combobox/combobox.tsx`, `menu/menu.tsx`, `menu/submenu.tsx`, `context-menu/context-menu.tsx`, `select/select.tsx`, `popover/popover.tsx`, `dialog/dialog.tsx`, `tooltip/tooltip.tsx`)

- [ ] **Step 1: Rename the symbol with Serena** (most reliable for an exported symbol with ~13 call sites; runs against the primary checkout). Load the tools once, then rename:

Load: `ToolSearch` with `select:mcp__serena__rename_symbol,mcp__serena__find_referencing_symbols`
Then `mcp__serena__rename_symbol` on `useRender` (in `packages/ui/src/use-render.ts`) to `renderElement`.

If Serena is unavailable (MCP down or worktree), fall back to a manual rename: in `packages/ui/src/use-render.ts` rename `export function useRender` -> `export function renderElement`; then in each call-site file change the import `import { useRender, type RenderProp } from '../use-render.js';` -> `import { renderElement, type RenderProp } from '../use-render.js';` and every `useRender<...>(...)` / `useRender(...)` call -> `renderElement<...>(...)` / `renderElement(...)`.

- [ ] **Step 2: Rename the internal options interface.** In `packages/ui/src/use-render.ts`, rename `interface UseRenderOptions<State>` -> `interface RenderElementOptions<State>` and update its use in the `renderElement` signature (`opts: RenderElementOptions<State>`). Leave the public `RenderProp<State>` type name unchanged.

- [ ] **Step 3: Update the barrel.** In `packages/ui/src/index.ts` line 4, change:

```ts
export { useRender, type RenderProp } from './use-render.js';
```

to:

```ts
export { renderElement, type RenderProp } from './use-render.js';
```

- [ ] **Step 4: Verify no `useRender` references remain.**

Run: `rg -n 'useRender|UseRenderOptions' packages/ui/src --glob '!**/dist/**'`
Expected: zero matches.

- [ ] **Step 5: Build + typecheck + ui suite.**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck`
Expected: clean.
Run: `pnpm --filter @hono-preact/ui exec vitest run`
Expected: pass (behavior unchanged; the suite is the parity oracle).

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "refactor(ui): rename useRender to renderElement (it is not a hook)"
```

---

## Task 8: Full pre-push CI verification

No code changes. Run the six CI steps in order from the repo root. This is the cross-package backstop: typecheck + the full suite confirm nothing still references any removed/renamed surface.

- [ ] **Step 1:** `pnpm --filter '@hono-preact/*' --filter hono-preact build` -> clean.
- [ ] **Step 2:** `pnpm format:check` -> pass (run `pnpm format` first if needed, then re-commit, then re-check; do not push unformatted commits).
- [ ] **Step 3:** `pnpm typecheck` -> clean.
- [ ] **Step 4:** `pnpm test:coverage` -> all pass (iso, server, vite, ui, create-hono-preact, site). This is where a missed consumer of `useRouteChange`/`env`/`loaderUse`/`renderElement` would surface.
- [ ] **Step 5:** `pnpm test:integration` -> pass (covers the scaffolder).
- [ ] **Step 6:** `pnpm --filter site build` -> clean (the project-layout migration + noop deletion + docs edits).
- [ ] **Step 7:** Report each step's result. Do not push; the PR is opened after this plan completes per the session workflow.

---

## Self-Review

**Spec coverage:**
- Item 1 (useRouteChange + legacy slot + site migration) -> Task 1.
- Item 2 (/__actions reservation, all 5 sites + test) -> Task 2.
- Item 3 (loaderUse/actionUse + the contract/parser/validation/server-only machinery + 3 tests) -> Task 3, traced to its full extent (findUseExports only feeds validation; hasNamedUseExport only feeds tests).
- Item 4 (env demote to internal/runtime + codegen + test + docs) -> Task 4.
- Item 5 (noop.tsx) -> Task 5.
- Item 6 (scaffolder version from package.json + tightened test) -> Task 6.
- Item 7 (useRender -> renderElement, function + options interface + barrel + call sites) -> Task 7.
- Testing strategy (full-suite backstop + per-item test updates) -> each task's verify steps + Task 8.

**Placeholder scan:** No TBD/TODO. Each removal step names exact files/lines and the surrounding context to read. The two places that say "read the file to get exact block boundaries" (Task 3 Step 3 validation block, Task 2 Step 3 contract comment) are bounded removals where the exact line span is given approximately and the edit is unambiguous (remove the named block), not vague instructions.

**Type/name consistency:** `renderElement` and `RenderElementOptions` (Task 7) are used consistently; the kept public type is `RenderProp` everywhere. `env` is removed from the iso barrel and added to `internal-runtime.ts`, and the codegen + test reference `hono-preact/internal/runtime` consistently (Task 4). `RESERVED_PATHS` keeps `LOADERS_RPC_PATH` only (Task 2). `RECOGNIZED_SERVER_EXPORTS` keeps `['serverActions', 'serverLoaders']` (Task 3).
