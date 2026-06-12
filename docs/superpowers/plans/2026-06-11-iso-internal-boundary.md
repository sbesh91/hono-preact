# Iso internal boundary (Section B, PR B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iso package the same three-tier boundary B1 gave the server package: a framework-emitted `/internal/runtime` door holding pure plumbing (the client-entry installers, the server-only loader stub, and the whole wire-contract constants module), `/internal` reduced to a genuine escape-hatch tier, and the `getViewTransitionDirection` barrel leak removed. Add a codegen-invariant test so the runtime door cannot drift from what the framework emits.

**Architecture:** Sequencing is **add the new door → repoint every consumer → only then remove from `/internal`**, so every intermediate commit builds and tests green. The blast radius is wide because the iso `/internal` door is consumed by the emitted client/server code, by five vite plugins at build time, by the umbrella, and by several test/alias configs.

**Tech Stack:** TypeScript, plain `tsc` builds, Vitest, pnpm workspaces, the umbrella `consolidate.mjs` dist-rewrite step.

**Source spec:** `docs/superpowers/specs/2026-06-11-public-internal-boundary-design.md` (PR B2 section). Builds on PR B1 (merged, `3fd8d18`), which established the `/internal/runtime` pattern for the server package; mirror its mechanics.

**Conventions:**
- Run a single test file with `pnpm exec vitest run <path>` from the repo root.
- No em-dashes in code/comments/commit messages (repo rule): comma, colon, semicolon, parentheses, or two sentences.
- If a build errors with `Cannot find module '@hono-preact/...'`, run `pnpm install` once (stale workspace symlinks) and retry; it is not a code problem.
- Commit after each task; commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

---

## Tier-3 membership (what moves to `/internal/runtime`)

Exactly these, all pure plumbing the framework emits or its plugins import:
- **Installers** (emitted by the client-entry codegen): `installHistoryShim` (`./internal/history-shim.js`), `installNavTransitionScheduler` (`./internal/route-change.js`), `installStreamRegistry` (`./internal/stream-registry.js`).
- **Loader stub** (emitted by the server-only plugin): `__$createLoaderStub_hpiso` (`./internal/loader-stub.js`).
- **Wire-contract constants** (the whole `./internal/contract.js` module): `LOADERS_RPC_PATH`, `CLIENT_ENTRY_FILE`, `CLIENT_ENTRY_URL`, `VIRTUAL_CLIENT_ID`, `VIRTUAL_CLIENT_DEV_URL`, `MODULE_KEY_EXPORT`, `LOADER_NAME_OPTION`, `FORM_MODULE_FIELD`, `FORM_ACTION_FIELD`.

Everything else on `/internal` stays escape-hatch. Note the split exports: `getNavDirection` stays on `/internal` (only `installHistoryShim` moves); `__subscribeRouteChange`/`__subscribePhase` stay (only `installNavTransitionScheduler` moves); `subscribeToLoaderStream` stays (only `installStreamRegistry` moves).

## File map

- **Create** `packages/iso/src/internal-runtime.ts`, the iso framework-emitted door.
- **Create** `packages/iso/src/__tests__/internal-runtime.test.ts`, door contents + the codegen invariant.
- **Create** `packages/hono-preact/src/internal-runtime.ts`, umbrella re-export.
- **Modify** `packages/iso/package.json`, add `./internal/runtime`.
- **Modify** `packages/iso/src/internal.ts`, remove the moved symbols, rewrite header, add SSE comment.
- **Modify** `packages/iso/src/index.ts`, remove the `getViewTransitionDirection` barrel leak.
- **Modify** `packages/hono-preact/package.json` + `scripts/consolidate.mjs`, umbrella subpath + rewrite rule.
- **Modify** `packages/vite/src/client-entry.ts` + `server-only.ts` (emitted strings + build-time imports), `hono-preact.ts`, `server-entry.ts`, `module-key-plugin.ts` (build-time imports).
- **Modify** `packages/vite/src/__tests__/client-entry.test.ts` (emitted-string assertion), `packages/vite/src/__tests__/guards-bundle.test.ts` (externals), `packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts` (aliases).
- **Modify** `vitest.config.ts`, `apps/site/vite.config.ts`, `apps/example-node/vite.config.ts` (aliases).
- **Modify** `packages/hono-preact/__tests__/exports.test.ts` (move `installStreamRegistry` to the runtime door block).

---

## Task 1: Add the iso `/internal/runtime` door (additive; both doors coexist)

**Files:**
- Create: `packages/iso/src/internal-runtime.ts`
- Create: `packages/iso/src/__tests__/internal-runtime.test.ts`
- Modify: `packages/iso/package.json`

- [ ] **Step 1: Write the door-contents test.** Create `packages/iso/src/__tests__/internal-runtime.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as runtime from '../internal-runtime.js';
import * as contract from '../internal/contract.js';

const PLUMBING = [
  'installHistoryShim',
  'installNavTransitionScheduler',
  'installStreamRegistry',
  '__$createLoaderStub_hpiso',
] as const;

describe('iso /internal/runtime door', () => {
  it('exposes the framework-emitted plumbing as functions', () => {
    for (const name of PLUMBING) {
      expect(typeof (runtime as Record<string, unknown>)[name]).toBe(
        'function'
      );
    }
  });

  it('re-exports the entire wire-contract constants module', () => {
    for (const key of Object.keys(contract)) {
      expect((runtime as Record<string, unknown>)[key]).toBe(
        (contract as Record<string, unknown>)[key]
      );
    }
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (cannot resolve `../internal-runtime.js`). `pnpm exec vitest run packages/iso/src/__tests__/internal-runtime.test.ts`

- [ ] **Step 3: Create the door** `packages/iso/src/internal-runtime.ts`:

```ts
// @hono-preact/iso/internal/runtime: framework-emitted tier.
//
// Pure plumbing the framework's own code depends on: the installers the
// generated client entry calls, the loader stub the server-only plugin
// emits, and the cross-package wire-contract constants our vite plugins
// import at build time. Users never import this door. It is co-versioned
// with the codegen that emits it and may change in any non-major release.
export { installHistoryShim } from './internal/history-shim.js';
export { installNavTransitionScheduler } from './internal/route-change.js';
export { installStreamRegistry } from './internal/stream-registry.js';
export { __$createLoaderStub_hpiso } from './internal/loader-stub.js';
export * from './internal/contract.js';
```

- [ ] **Step 4: Add the iso package export.** In `packages/iso/package.json`, add to `exports` after the `./internal` block (mind the trailing comma):

```json
    "./internal/runtime": {
      "types": "./dist/internal-runtime.d.ts",
      "import": "./dist/internal-runtime.js"
    },
```

- [ ] **Step 5: Run the test; expect PASS.** `pnpm exec vitest run packages/iso/src/__tests__/internal-runtime.test.ts`

- [ ] **Step 6: Confirm `/internal` still has the symbols (no removal yet) so nothing is broken.** `pnpm exec vitest run packages/iso` should pass unchanged.

- [ ] **Step 7: Commit.** Verify `git status` shows only the 3 files.
```bash
git add packages/iso/src/internal-runtime.ts \
  packages/iso/src/__tests__/internal-runtime.test.ts \
  packages/iso/package.json
git commit -m "feat(iso): add /internal/runtime framework-emitted door (additive)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Umbrella `hono-preact/internal/runtime` subpath

**Files:**
- Create: `packages/hono-preact/src/internal-runtime.ts`
- Modify: `packages/hono-preact/package.json`
- Modify: `packages/hono-preact/scripts/consolidate.mjs`

- [ ] **Step 1: Create** `packages/hono-preact/src/internal-runtime.ts`:

```ts
export * from '@hono-preact/iso/internal/runtime';
```

- [ ] **Step 2: Add the umbrella export.** In `packages/hono-preact/package.json` `exports`, after the existing `./internal` entry (keep JSON valid):

```json
    "./internal/runtime": {
      "types": "./dist/internal-runtime.d.ts",
      "import": "./dist/internal-runtime.js"
    },
```

(`./internal` stays mapped to `dist/internal.js`. The new key is the iso escape-hatch door's sibling.)

- [ ] **Step 3: Teach `consolidate.mjs` BOTH the map and the regex.** In `packages/hono-preact/scripts/consolidate.mjs`:

(a) `DIST_PATHS` add:
```js
  '@hono-preact/iso/internal/runtime': 'iso/internal-runtime.js',
```

(b) the matcher regex (the line beginning `/(['"])(@hono-preact\/(?:`): add `iso\/internal\/runtime` listed **before** `iso\/internal` (longest-first), so the group reads:
```js
    /(['"])(@hono-preact\/(?:iso\/internal\/runtime|iso\/internal|iso\/page|iso|server\/internal\/runtime|server|vite\/adapter-cloudflare|vite\/adapter-node|vite))(['"])/g,
```
(B1 already added `server/internal/runtime`; this adds the iso one. Verify balanced parens and the `g` flag.)

- [ ] **Step 4: Build iso + umbrella.** `pnpm --filter @hono-preact/iso --filter hono-preact build` → expect PASS.

- [ ] **Step 5: Verify the consolidated dist rewrote the specifier.** `grep -n "internal-runtime" packages/hono-preact/dist/internal-runtime.js` → the import target is the relative `./iso/internal-runtime.js`; and `grep -c "@hono-preact/iso/internal/runtime" packages/hono-preact/dist/internal-runtime.js` prints `0`.

- [ ] **Step 6: Commit.** `git status` shows only the 3 files.
```bash
git add packages/hono-preact/src/internal-runtime.ts \
  packages/hono-preact/package.json \
  packages/hono-preact/scripts/consolidate.mjs
git commit -m "feat(hono-preact): expose internal/runtime umbrella subpath

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Repoint every consumer to the new door

All consumers still point at `/internal`; the symbols are still there too, so this task is safe to do in any sub-order. After it, nothing reads the moved symbols via `/internal`.

**Files:**
- Modify: `packages/vite/src/client-entry.ts`, `packages/vite/src/server-only.ts`, `packages/vite/src/hono-preact.ts`, `packages/vite/src/server-entry.ts`, `packages/vite/src/module-key-plugin.ts`
- Modify: `packages/vite/src/__tests__/client-entry.test.ts`, `packages/vite/src/__tests__/guards-bundle.test.ts`, `packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts`
- Modify: `vitest.config.ts`, `apps/site/vite.config.ts`, `apps/example-node/vite.config.ts`

- [ ] **Step 1: Add the test-resolution aliases FIRST (so the repointed plugin imports resolve in vitest).** In `vitest.config.ts` `resolve.alias`, add BEFORE the existing `'@hono-preact/iso/internal'` entry:
```ts
      '@hono-preact/iso/internal/runtime': path.resolve(
        __dirname,
        'packages/iso/src/internal-runtime.ts'
      ),
```
and add (anywhere among the `hono-preact/*` aliases, but BEFORE `'hono-preact/internal'`):
```ts
      'hono-preact/internal/runtime': path.resolve(
        __dirname,
        'packages/hono-preact/src/internal-runtime.ts'
      ),
```

- [ ] **Step 2: Update the client-entry emitted-string test.** In `packages/vite/src/__tests__/client-entry.test.ts`, change the expected import line from `... from 'hono-preact/internal';` to `... from 'hono-preact/internal/runtime';` (the assertion at line ~27 quoting `import { installNavTransitionScheduler, installStreamRegistry, installHistoryShim } from 'hono-preact/internal';`).

- [ ] **Step 3: Run that test; expect FAIL.** `pnpm exec vitest run packages/vite/src/__tests__/client-entry.test.ts`

- [ ] **Step 4: Repoint `client-entry.ts`.** Two edits:
  - The emitted string (line 19): `from 'hono-preact/internal';` to `from 'hono-preact/internal/runtime';`.
  - The build-time import (line 3): `import { VIRTUAL_CLIENT_ID } from '@hono-preact/iso/internal';` to `from '@hono-preact/iso/internal/runtime';`.

- [ ] **Step 5: Run it; expect PASS.** `pnpm exec vitest run packages/vite/src/__tests__/client-entry.test.ts`

- [ ] **Step 6: Repoint `server-only.ts`.** Two edits:
  - The emitted loader-stub string (~line 322): `import { __$createLoaderStub_hpiso } from 'hono-preact/internal';` to `... from 'hono-preact/internal/runtime';`.
  - The build-time constants import (lines 7-12): change `from '@hono-preact/iso/internal';` to `from '@hono-preact/iso/internal/runtime';`.

- [ ] **Step 7: Repoint the three build-time-only plugin imports** to `@hono-preact/iso/internal/runtime`:
  - `packages/vite/src/hono-preact.ts:3` (`CLIENT_ENTRY_FILE`)
  - `packages/vite/src/server-entry.ts:5` (`LOADERS_RPC_PATH`)
  - `packages/vite/src/module-key-plugin.ts:5-8` (`MODULE_KEY_EXPORT`, `LOADER_NAME_OPTION`)

- [ ] **Step 8: Add the guards-bundle externals.** In `packages/vite/src/__tests__/guards-bundle.test.ts`, in the `external` array (currently listing `@hono-preact/iso/internal` and `hono-preact/internal`), add `'@hono-preact/iso/internal/runtime'` and `'hono-preact/internal/runtime'`.

- [ ] **Step 9: Add the leak-test fixture aliases.** In `packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts`, add BEFORE the `'hono-preact/internal'` alias:
```ts
      {
        find: 'hono-preact/internal/runtime',
        replacement: resolve(__dirname, '../../../../../iso/src/internal-runtime.ts'),
      },
```
and BEFORE the `'@hono-preact/iso/internal'` alias:
```ts
      {
        find: '@hono-preact/iso/internal/runtime',
        replacement: resolve(__dirname, '../../../../../iso/src/internal-runtime.ts'),
      },
```

- [ ] **Step 10: Add the dogfood-app aliases** (same shape as B1, but for the internal door). In BOTH `apps/site/vite.config.ts` and `apps/example-node/vite.config.ts`, add BEFORE `hono-preact/internal`:
```ts
{ find: 'hono-preact/internal/runtime', replacement: resolve(__dirname, '../../packages/hono-preact/src/internal-runtime.ts') },
```
and BEFORE `@hono-preact/iso/internal`:
```ts
{ find: '@hono-preact/iso/internal/runtime', replacement: resolve(__dirname, '../../packages/iso/src/internal-runtime.ts') },
```
(Match each file's existing object style: `apps/site` uses multi-line `{ find, replacement }` objects; `apps/example-node` uses single-line.)

- [ ] **Step 11: Run the full vite suite + the umbrella exports test.** `pnpm exec vitest run packages/vite packages/hono-preact` → expect PASS. (The plugins now import constants from the runtime door, resolved via the new vitest aliases.)

- [ ] **Step 12: Commit.** 
```bash
git add packages/vite/src vitest.config.ts apps/site/vite.config.ts apps/example-node/vite.config.ts
git commit -m "refactor(vite,apps): import iso framework-emitted plumbing from /internal/runtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Remove the moved symbols from `/internal`, rewrite the header, add the SSE note

Now that no consumer reads them via `/internal`, remove them. `getNavDirection`, `__subscribeRouteChange`, `__subscribePhase`, `subscribeToLoaderStream`, and `readSSE` STAY.

**Files:**
- Modify: `packages/iso/src/internal.ts`
- Modify: `packages/hono-preact/__tests__/exports.test.ts`

- [ ] **Step 1: Edit `packages/iso/src/internal.ts`.** Apply these precise changes:
  - The route-change export block `export { installNavTransitionScheduler, __subscribeRouteChange } from './internal/route-change.js';` becomes `export { __subscribeRouteChange } from './internal/route-change.js';`.
  - The history-shim export block `export { installHistoryShim, getNavDirection } from './internal/history-shim.js';` becomes `export { getNavDirection } from './internal/history-shim.js';`.
  - The stream-registry export block `export { installStreamRegistry, subscribeToLoaderStream } from './internal/stream-registry.js';` becomes `export { subscribeToLoaderStream } from './internal/stream-registry.js';`.
  - Delete the line `export { __$createLoaderStub_hpiso } from './internal/loader-stub.js';`.
  - Delete the entire wire-contract constants re-export block (the `export { LOADERS_RPC_PATH, ... FORM_ACTION_FIELD } from './internal/contract.js';` block and its `// Cross-package wire-contract constants ...` comment).
  - Delete the now-obsolete "Section 2: framework-emitted (DO NOT IMPORT FROM USER CODE)" comment banner (the symbols it described have moved to `/internal/runtime`).

- [ ] **Step 2: Rewrite the file header** (the top comment block) to describe an honest escape-hatch tier. Replace the existing top banner with:

```ts
// @hono-preact/iso/internal: escape-hatch tier for advanced consumers.
//
// These primitives compose the default <Page> pipeline by hand: custom
// middleware composition, distinct fallbacks for the middleware host vs.
// the loader, advanced SSR work. Reach for them knowingly and expect to
// read the source.
//
// STABILITY: intentionally less stable than the package's main surface.
// Symbols may be renamed, retyped, or removed in any non-major release.
// Pin a framework version if your code reaches in here.
//
// (Framework plumbing the generated code and our vite plugins depend on
// lives on the separate `/internal/runtime` door, not here.)
```

- [ ] **Step 3: Add the SSE note** above the `readSSE` export (which stays). Replace its existing comment with:
```ts
// SSE codec (decoder). The encoder and the SSE wire format are intentionally
// framework-internal (the encoder is package-private in @hono-preact/server);
// readSSE is the one blessed escape-hatch for reading a streaming
// loader/action response as typed events in tests and advanced consumers.
export { readSSE } from './internal/sse-decoder.js';
export type { SSEEvent } from './internal/sse-decoder.js';
```

- [ ] **Step 4: Move the `installStreamRegistry` assertion in the umbrella exports test.** In `packages/hono-preact/__tests__/exports.test.ts`, the `describe('hono-preact/internal export', ...)` block currently asserts `expect(typeof m.installStreamRegistry).toBe('function');`. Remove that line from that block, and add a new block after it:
```ts
describe('hono-preact/internal/runtime export', () => {
  it('surfaces the framework-emitted installers + loader stub', async () => {
    const m = await import('hono-preact/internal/runtime');
    expect(typeof m.installHistoryShim).toBe('function');
    expect(typeof m.installNavTransitionScheduler).toBe('function');
    expect(typeof m.installStreamRegistry).toBe('function');
    expect(typeof m.__$createLoaderStub_hpiso).toBe('function');
    expect(typeof m.LOADERS_RPC_PATH).toBe('string');
  });

  it('no longer surfaces the installers from the escape-hatch /internal door', async () => {
    const m = await import('hono-preact/internal');
    expect('installStreamRegistry' in m).toBe(false);
    expect('installHistoryShim' in m).toBe(false);
  });
});
```

- [ ] **Step 5: Run iso + umbrella tests.** `pnpm exec vitest run packages/iso packages/hono-preact` → expect PASS.

- [ ] **Step 6: Build + typecheck (confirms no source still imports the moved symbols via `/internal`).** `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck` → expect PASS. If the vite package fails to resolve `@hono-preact/iso/internal/runtime`, the build copies the iso dist that now has `internal-runtime.js`; ensure Task 1/2 built. If a `Cannot find module` appears for an unrelated `@hono-preact/*`, run `pnpm install` and retry.

- [ ] **Step 7: Commit.**
```bash
git add packages/iso/src/internal.ts packages/hono-preact/__tests__/exports.test.ts
git commit -m "refactor(iso): reduce /internal to escape-hatch-only; plumbing now on /internal/runtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Remove the `getViewTransitionDirection` barrel leak

**Files:**
- Modify: `packages/iso/src/index.ts`
- (Possibly) Modify: a test if one asserts the symbol on the barrel.

- [ ] **Step 1: Search for consumers.** `grep -rn "getViewTransitionDirection" packages apps --include="*.ts" --include="*.tsx"`. It is documented as orphaned/undocumented; expect only the barrel re-export (`index.ts:147`) and possibly a test. If any non-test source uses it, STOP and report (do not break a real consumer).

- [ ] **Step 2: Remove the barrel re-export.** Delete `packages/iso/src/index.ts:147`: `export { getNavDirection as getViewTransitionDirection } from './internal/history-shim.js';` (and the adjacent comment if it solely describes this line). `getNavDirection` remains reachable on `/internal`.

- [ ] **Step 3: If a test asserted it on the barrel, update that test** to reflect its removal (or delete the stale assertion). Re-run the affected test.

- [ ] **Step 4: Build + typecheck + the iso suite.** `pnpm --filter @hono-preact/iso --filter hono-preact build && pnpm typecheck && pnpm exec vitest run packages/iso` → expect PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/iso/src/index.ts
git commit -m "refactor(iso): drop getViewTransitionDirection barrel re-export of an internal symbol

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Codegen-invariant test

Lock the runtime door to what the framework actually emits, so it cannot silently grow or shrink.

**Files:**
- Modify: `packages/iso/src/__tests__/internal-runtime.test.ts`

- [ ] **Step 1: Add the invariant assertion** to the existing test file. Append inside the `describe`:

```ts
  it('exports exactly the plumbing set plus the contract module (no drift)', () => {
    const expected = new Set<string>([...PLUMBING, ...Object.keys(contract)]);
    const actual = new Set(Object.keys(runtime));
    expect([...actual].sort()).toEqual([...expected].sort());
  });
```

This pins the door's surface: the four plumbing symbols plus every contract constant, and nothing else. If a future change adds an export to `internal-runtime.ts` that is neither plumbing nor a contract constant, or the codegen stops emitting one, this test fails.

- [ ] **Step 2: Run it; expect PASS.** `pnpm exec vitest run packages/iso/src/__tests__/internal-runtime.test.ts`

- [ ] **Step 3: Commit.**
```bash
git add packages/iso/src/__tests__/internal-runtime.test.ts
git commit -m "test(iso): pin /internal/runtime to the emitted plumbing + contract set

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full pre-push verification

**Files:** none.

- [ ] **Step 1: Run the six-step CI mirror in order, each expecting PASS:**
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

- [ ] **Step 2: If `format:check` fails,** `pnpm format`, restage into the relevant commit or a `style:` commit, and re-run from Step 1. (B1 lesson: a re-export line can exceed the print width and need wrapping.)

- [ ] **Step 3: Integration is the end-to-end proof.** `pnpm test:integration` builds a real app whose generated CLIENT entry now imports `hono-preact/internal/runtime` (the installers) and whose server-only transform emits the loader stub from it. A green run proves the umbrella subpath, the consolidate rewrite, the codegen, and the app aliases all agree. The site build (Step 1 #6) is the second real-app proof (it uses the same client-entry codegen).

---

## Self-review

- **Spec coverage (PR B2):** new `/internal/runtime` door (Task 1), `/internal` reduced to escape-hatch + header rewrite + SSE note (Task 4), barrel leak removed (Task 5), umbrella wiring (Task 2), codegen + plugin imports repointed (Task 3), invariant test (Task 6). All present.
- **Green-between-tasks:** add door (1) and umbrella (2) are additive; repoint (3) works because the symbols still exist on both doors; removal (4) is safe because (3) already moved every reader; barrel (5) and invariant (6) are independent. No intermediate red state.
- **Touch-point completeness (the easy-to-miss set):** vitest alias, both app aliases, leak-test fixture aliases, guards-bundle externals, client-entry emitted-string test, exports.test.ts installStreamRegistry move, consolidate regex AND DIST_PATHS. Each has an explicit step.
- **Type/name consistency:** the four plumbing names + the nine contract constant names are identical across the door, the tests, and the PLUMBING/`Object.keys(contract)` invariant. The subpath string `hono-preact/internal/runtime` / `@hono-preact/iso/internal/runtime` is identical across codegen, umbrella, aliases, and externals.
