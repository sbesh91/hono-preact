# Server internal boundary (Section B, PR B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the framework-emitted server resolver factories off the public `@hono-preact/server` door onto a new `/internal/runtime` subpath, re-export `LoadersHandlerOptions` so the documented hand-wiring path can name its options type, and relocate `pickAccept` into a dedicated internal module.

**Architecture:** Three stability tiers (public `.`, escape-hatch `/internal`, framework-emitted `/internal/runtime`). PR B1 implements the server half: the three factories (`routeServerModules`, `makePageUseResolvers`, `makePageActionResolvers`) become a framework-emitted tier on `@hono-preact/server/internal/runtime`, re-exposed through the umbrella as `hono-preact/server/internal/runtime`, which the generated server entry imports. `ActionEntry` stays public (it is in the public `pageActionHandler` options signature). No documented symbol moves, so there is zero user-facing breakage.

**Tech Stack:** TypeScript, plain `tsc` builds, Vitest, pnpm workspaces, the umbrella `consolidate.mjs` dist-rewrite step.

**Source spec:** `docs/superpowers/specs/2026-06-11-public-internal-boundary-design.md` (PR B1 section).

**Conventions:**
- Run a single test file with `pnpm exec vitest run <path>` from the repo root.
- Never push without the six-step pre-push mirror in `CLAUDE.md` (Task 5 runs it).
- Commit after each task; commit messages end with the `Co-Authored-By` trailer.

---

## File map

- **Create** `packages/server/src/accept.ts` — the `Accept` type + `pickAccept` content negotiation helper, moved out of `page-action-handler.ts`.
- **Create** `packages/server/src/__tests__/accept.test.ts` — the `pickAccept` unit tests, moved out of `page-action-handler.test.ts`.
- **Create** `packages/server/src/internal-runtime.ts` — the framework-emitted door re-exporting the three factories.
- **Create** `packages/server/src/__tests__/boundary.test.ts` — asserts the factory relocation and the `LoadersHandlerOptions` re-export.
- **Create** `packages/hono-preact/src/server-internal-runtime.ts` — umbrella re-export of the server runtime door.
- **Modify** `packages/server/src/page-action-handler.ts` — import `Accept`/`pickAccept` from `./accept.js`, delete the local definitions.
- **Modify** `packages/server/src/__tests__/page-action-handler.test.ts` — drop the `pickAccept` import and its `describe` block.
- **Modify** `packages/server/src/index.ts` — remove the three factory re-exports; add `LoadersHandlerOptions`.
- **Modify** `packages/server/package.json` — add the `./internal/runtime` export.
- **Modify** `packages/vite/src/server-entry.ts` — split the generated import so the factories come from `hono-preact/server/internal/runtime`.
- **Modify** `packages/vite/src/__tests__/server-entry.test.ts` — update the expected generated-import string.
- **Modify** `packages/hono-preact/package.json` — add the `./server/internal/runtime` export.
- **Modify** `packages/hono-preact/scripts/consolidate.mjs` — add the `DIST_PATHS` rewrite entry.

---

## Task 1: Extract `pickAccept` into an internal `accept.ts` module

**Files:**
- Create: `packages/server/src/accept.ts`
- Create: `packages/server/src/__tests__/accept.test.ts`
- Modify: `packages/server/src/page-action-handler.ts` (remove `type Accept` at line 79 and `pickAccept` at lines 89-115; add an import)
- Modify: `packages/server/src/__tests__/page-action-handler.test.ts` (remove the `pickAccept` import on line 4 and the `describe('pickAccept', …)` block at lines 317-357)

- [ ] **Step 1: Write the moved unit test against the new module**

Create `packages/server/src/__tests__/accept.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickAccept } from '../accept.js';

describe('pickAccept', () => {
  it('maps application/json to json', () => {
    expect(pickAccept('application/json')).toBe('json');
  });
  it('maps text/event-stream to event-stream', () => {
    expect(pickAccept('text/event-stream')).toBe('event-stream');
  });
  it('maps text/html to html', () => {
    expect(pickAccept('text/html')).toBe('html');
  });
  it('maps */* to html', () => {
    expect(pickAccept('*/*')).toBe('html');
  });
  it('defaults missing/empty Accept to html', () => {
    expect(pickAccept(undefined)).toBe('html');
    expect(pickAccept('')).toBe('html');
  });
  it('honors q-values when choosing the best candidate', () => {
    expect(pickAccept('application/json, text/event-stream;q=0.9')).toBe(
      'json'
    );
  });
  it('breaks q-value ties by Accept order', () => {
    expect(pickAccept('application/json, text/event-stream')).toBe('json');
    expect(pickAccept('text/event-stream, application/json')).toBe(
      'event-stream'
    );
  });
  it('ignores unparseable q-values (defaults q to 1.0)', () => {
    expect(pickAccept('application/json;q=invalid')).toBe('json');
  });
  it('ignores unsupported media types', () => {
    expect(pickAccept('text/plain, application/json;q=0.5')).toBe('json');
  });
  it('treats q=0 as a real (lowest) preference, not exclusion', () => {
    expect(pickAccept('application/json;q=0')).toBe('json');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/__tests__/accept.test.ts`
Expected: FAIL — `Failed to resolve import "../accept.js"` (module does not exist yet).

- [ ] **Step 3: Create the `accept.ts` module**

Create `packages/server/src/accept.ts` (verbatim move of the type + function from `page-action-handler.ts`):

```ts
export type Accept = 'html' | 'json' | 'event-stream';

/**
 * Content negotiation for action POSTs: chooses json (RPC), event-stream
 * (streaming action), or html (progressive-enhancement form post) from the
 * request's Accept header. Highest q-value wins; ties break by Accept order.
 * `*\/*` and `text/html` map to html; unsupported media types are ignored.
 * Unspecified quality defaults to 1.0; an empty/missing header defaults to html.
 */
export function pickAccept(header: string | undefined): Accept {
  const h = header ?? '';
  type Candidate = { type: Accept; q: number };
  const candidates: Candidate[] = [];

  for (const part of h.split(',')) {
    const [mediaType, ...params] = part.trim().split(';');
    const mt = (mediaType ?? '').trim().toLowerCase();
    let q = 1.0;
    for (const p of params) {
      const kv = p.trim().split('=');
      if (kv[0]?.trim() === 'q' && kv[1] !== undefined) {
        const parsed = Number(kv[1].trim());
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }
    if (mt === 'text/event-stream')
      candidates.push({ type: 'event-stream', q });
    else if (mt === 'application/json') candidates.push({ type: 'json', q });
    else if (mt === 'text/html' || mt === '*/*')
      candidates.push({ type: 'html', q });
  }

  if (candidates.length === 0) return 'html';
  candidates.sort((a, b) => b.q - a.q);
  return candidates[0]!.type;
}
```

(Note: the `*\/*` in the doc comment above is an escaped block-comment terminator — write it as `*/*` in the actual file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/server/src/__tests__/accept.test.ts`
Expected: PASS (11 assertions).

- [ ] **Step 5: Point `page-action-handler.ts` at the new module and delete the local copies**

In `packages/server/src/page-action-handler.ts`:
- Delete `type Accept = 'html' | 'json' | 'event-stream';` (line 79) and the entire `export function pickAccept(...) { ... }` block (lines 89-115, including its doc comment).
- Add to the import block at the top of the file (next to the other `./*.js` imports):

```ts
import { pickAccept, type Accept } from './accept.js';
```

(`pickAccept` is still called at the former line 193; `Accept` is used by `pickAccept`'s return site. The import covers both.)

- [ ] **Step 6: Remove the moved test from `page-action-handler.test.ts`**

In `packages/server/src/__tests__/page-action-handler.test.ts`:
- Change line 4 from `import { pageActionHandler, pickAccept } from '../page-action-handler.js';` to `import { pageActionHandler } from '../page-action-handler.js';`
- Delete the entire `describe('pickAccept', () => { ... });` block (lines 317-357).

- [ ] **Step 7: Run the full server test suite**

Run: `pnpm exec vitest run packages/server`
Expected: PASS — `accept.test.ts` green, `page-action-handler.test.ts` green without the moved block, nothing else changed.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/accept.ts \
  packages/server/src/__tests__/accept.test.ts \
  packages/server/src/page-action-handler.ts \
  packages/server/src/__tests__/page-action-handler.test.ts
git commit -m "refactor(server): extract pickAccept into internal accept module

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Server `/internal/runtime` door + relocate the factories, re-export `LoadersHandlerOptions`

**Files:**
- Create: `packages/server/src/internal-runtime.ts`
- Create: `packages/server/src/__tests__/boundary.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json`

- [ ] **Step 1: Write the boundary test (value relocation + type re-export)**

Create `packages/server/src/__tests__/boundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as publicEntry from '../index.js';
import * as runtime from '../internal-runtime.js';
// Type-surface check: this import + usage fails `tsc` if the re-export is
// missing. Vitest strips types, so the real enforcement is `pnpm typecheck`.
import type { LoadersHandlerOptions } from '../index.js';

const _loadersHandlerOptions: LoadersHandlerOptions = {};
void _loadersHandlerOptions;

const FACTORIES = [
  'routeServerModules',
  'makePageUseResolvers',
  'makePageActionResolvers',
] as const;

describe('server boundary', () => {
  it('exposes the framework-emitted factories on /internal/runtime as functions', () => {
    for (const name of FACTORIES) {
      expect(typeof (runtime as Record<string, unknown>)[name]).toBe(
        'function'
      );
    }
  });

  it('does not re-export the factories from the public entry', () => {
    for (const name of FACTORIES) {
      expect(name in publicEntry).toBe(false);
    }
  });

  it('keeps the public handler surface available', () => {
    expect(typeof publicEntry.renderPage).toBe('function');
    expect(typeof publicEntry.loadersHandler).toBe('function');
    expect(typeof publicEntry.pageActionHandler).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/__tests__/boundary.test.ts`
Expected: FAIL — `Failed to resolve import "../internal-runtime.js"` (module missing). (After the module exists, the `does not re-export` assertion is what the index edit must satisfy.)

- [ ] **Step 3: Create the framework-emitted door**

Create `packages/server/src/internal-runtime.ts`:

```ts
// @hono-preact/server/internal/runtime — framework-emitted tier.
//
// These factories exist ONLY because the framework's generated server entry
// imports and calls them (serverEntryPlugin). They are a private contract
// between this version's vite plugins and this version's runtime; they have
// no standalone user story. DO NOT IMPORT FROM USER CODE — this door is
// undocumented and may change in any non-major release in lockstep with the
// codegen that emits it.
export {
  routeServerModules,
  makePageUseResolvers,
} from './route-server-modules.js';
export { makePageActionResolvers } from './page-action-resolvers.js';
```

- [ ] **Step 4: Remove the factories from the public index and add `LoadersHandlerOptions`**

Replace the contents of `packages/server/src/index.ts` with:

```ts
export { HonoContext, useHonoContext } from './context.js';
export { renderPage } from './render.js';
export { loadersHandler, type LoadersHandlerOptions } from './loaders-handler.js';
export { type ActionEntry } from './page-action-resolvers.js';
export {
  pageActionHandler,
  type PageActionHandlerOptions,
} from './page-action-handler.js';
```

(`ActionEntry` stays public because `PageActionHandlerOptions.resolverByPath` references it. The three factories are gone from this door; they live on `./internal-runtime.js`.)

- [ ] **Step 5: Add the `./internal/runtime` export to the server package**

In `packages/server/package.json`, change the `exports` block to:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./internal/runtime": {
      "types": "./dist/internal-runtime.d.ts",
      "import": "./dist/internal-runtime.js"
    }
  },
```

- [ ] **Step 6: Run the boundary test and the full server suite**

Run: `pnpm exec vitest run packages/server`
Expected: PASS — `boundary.test.ts` green; resolver/handler tests unchanged (they import from their source modules, not the index).

- [ ] **Step 7: Typecheck the server package (validates the `LoadersHandlerOptions` re-export)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck`
Expected: PASS. (Build first so `dist/` is current — `typecheck` resolves cross-package types through `dist/`. The `_loadersHandlerOptions: LoadersHandlerOptions = {}` line in `boundary.test.ts` fails `tsc` if the type re-export is missing.)

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/internal-runtime.ts \
  packages/server/src/__tests__/boundary.test.ts \
  packages/server/src/index.ts \
  packages/server/package.json
git commit -m "refactor(server): move resolver factories to /internal/runtime, export LoadersHandlerOptions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Update the generated server entry to import factories from the runtime door

**Files:**
- Modify: `packages/vite/src/__tests__/server-entry.test.ts` (the expected import string at line 101)
- Modify: `packages/vite/src/server-entry.ts` (the codegen import block at lines 40-48)

- [ ] **Step 1: Update the test's expected generated-import string**

In `packages/vite/src/__tests__/server-entry.test.ts`, replace the single-block expectation (currently at line 101):

```ts
    expect(src).toContain(
      `import {\n  loadersHandler,\n  pageActionHandler,\n  renderPage,\n} from 'hono-preact/server';`
    );
    expect(src).toContain(
      `import {\n  makePageActionResolvers,\n  makePageUseResolvers,\n  routeServerModules,\n} from 'hono-preact/server/internal/runtime';`
    );
```

(The other assertions in this file — `makePageUseResolvers(routes.serverRoutes, { dev })`, `makePageActionResolvers(routes.serverRoutes, { dev })`, the `loadersHandler(serverModules, …)` call, etc. — stay valid: only the import source changes, not the call sites.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts`
Expected: FAIL — the generated source still emits the old single combined import from `hono-preact/server`.

- [ ] **Step 3: Split the codegen import block**

In `packages/vite/src/server-entry.ts`, replace this generated import (lines 40-48):

```ts
    `import {\n` +
    `  loadersHandler,\n` +
    `  makePageActionResolvers,\n` +
    `  makePageUseResolvers,\n` +
    `  pageActionHandler,\n` +
    `  renderPage,\n` +
    `  routeServerModules,\n` +
    `} from 'hono-preact/server';\n` +
```

with:

```ts
    `import {\n` +
    `  loadersHandler,\n` +
    `  pageActionHandler,\n` +
    `  renderPage,\n` +
    `} from 'hono-preact/server';\n` +
    `import {\n` +
    `  makePageActionResolvers,\n` +
    `  makePageUseResolvers,\n` +
    `  routeServerModules,\n` +
    `} from 'hono-preact/server/internal/runtime';\n` +
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full vite suite (catch any other codegen snapshot)**

Run: `pnpm exec vitest run packages/vite`
Expected: PASS — no other test asserts the old combined import (adapter/node-dev-server tests assert the entry-wrapper path, not the import block).

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/server-entry.ts \
  packages/vite/src/__tests__/server-entry.test.ts
git commit -m "feat(vite): import server resolver factories from /internal/runtime in generated entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Umbrella `hono-preact/server/internal/runtime` subpath

**Files:**
- Create: `packages/hono-preact/src/server-internal-runtime.ts`
- Modify: `packages/hono-preact/package.json`
- Modify: `packages/hono-preact/scripts/consolidate.mjs`

- [ ] **Step 1: Create the umbrella re-export file**

Create `packages/hono-preact/src/server-internal-runtime.ts`:

```ts
export * from '@hono-preact/server/internal/runtime';
```

- [ ] **Step 2: Add the umbrella export entry**

In `packages/hono-preact/package.json`, add to the `exports` block (after the `./internal` entry):

```json
    "./server/internal/runtime": {
      "types": "./dist/server-internal-runtime.d.ts",
      "import": "./dist/server-internal-runtime.js"
    }
```

(Add a comma after the previous `./internal` block so the JSON stays valid.)

- [ ] **Step 3: Teach `consolidate.mjs` to recognize and rewrite the new specifier**

`consolidate.mjs` rewrites a cross-package import only if (a) the specifier matches a hardcoded **regex alternation** and (b) it has a `DIST_PATHS` entry. Both must be updated, or the umbrella's `server-internal-runtime.js` keeps a bare `@hono-preact/server/internal/runtime` import that cannot resolve in a user's installed tarball.

First, the `DIST_PATHS` map (around line 48) — add:

```js
  '@hono-preact/server/internal/runtime': 'server/internal-runtime.js',
```

Second, the matcher regex (line 101). Change its alternation group from:

```js
    /(['"])(@hono-preact\/(?:iso\/internal|iso\/page|iso|server|vite\/adapter-cloudflare|vite\/adapter-node|vite))(['"])/g,
```

to (note `server\/internal\/runtime` is listed **before** `server` so the longer specifier wins the ordered alternation):

```js
    /(['"])(@hono-preact\/(?:iso\/internal|iso\/page|iso|server\/internal\/runtime|server|vite\/adapter-cloudflare|vite\/adapter-node|vite))(['"])/g,
```

(The trailing `(['"])` already prevents `server` from matching the `@hono-preact/server` prefix inside the longer string, but listing longest-first is the defensive convention and matters for B2's `iso/internal/runtime` too.)

- [ ] **Step 4: Build server + umbrella so the consolidated dist exists**

Run: `pnpm --filter @hono-preact/server --filter hono-preact build`
Expected: PASS, no errors.

- [ ] **Step 5: Verify the consolidated dist resolves end-to-end**

Run:

```bash
node --input-type=module -e "import('hono-preact/server/internal/runtime').then(m => { const ok = typeof m.makePageActionResolvers === 'function' && typeof m.makePageUseResolvers === 'function' && typeof m.routeServerModules === 'function'; if (!ok) { console.error('missing factory export', Object.keys(m)); process.exit(1); } console.log('resolved ok'); }).catch(e => { console.error(e); process.exit(1); });"
```

Expected: prints `resolved ok`. (This loads the umbrella's consolidated `dist/server-internal-runtime.js`, whose `@hono-preact/server/internal/runtime` import was rewritten by `consolidate.mjs` to the relative `./server/internal-runtime.js`. A failure here means the `DIST_PATHS` entry or the export map is wrong.)

- [ ] **Step 6: Confirm the rewrite happened in the shipped file**

Run: `grep -n "server/internal-runtime.js\|@hono-preact/server" packages/hono-preact/dist/server-internal-runtime.js`
Expected: the import target is the relative `./server/internal-runtime.js`; no bare `@hono-preact/server/internal/runtime` specifier survives.

- [ ] **Step 7: Commit**

```bash
git add packages/hono-preact/src/server-internal-runtime.ts \
  packages/hono-preact/package.json \
  packages/hono-preact/scripts/consolidate.mjs
git commit -m "feat(hono-preact): expose server/internal/runtime umbrella subpath

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full pre-push verification

**Files:** none (verification only).

- [ ] **Step 1: Run the six-step CI mirror in order**

Run each, expecting PASS before moving on (per `CLAUDE.md` "Pre-push verification"):

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

- [ ] **Step 2: If `format:check` fails, fix and amend**

Run: `pnpm format` then re-run `pnpm format:check`. Stage the formatting changes into the most relevant task commit (or a `style:` commit) and re-run from Step 1.

- [ ] **Step 3: Confirm the integration suite exercised the new path**

`pnpm test:integration` builds a real app whose generated server entry now imports `hono-preact/server/internal/runtime`. A green integration run is the end-to-end proof that the umbrella subpath, the consolidate rewrite, and the codegen change all agree. (If the integration scaffold step hangs or flakes for network reasons offline, note it and re-run when online; do not push on an un-run integration suite.)

---

## Notes for the next PR (B2, iso)

- B2 adds the iso `/internal/runtime` door (installers + loader stub + the whole `contract.ts` constants module), reduces `/internal` to escape-hatch-only with a rewritten header, removes the `getViewTransitionDirection` barrel leak, adds the codegen-invariant test, and folds in the minimal SSE comment.
- B2 also touches the umbrella (`./internal/runtime` for iso, plus the iso half of `consolidate.mjs`'s `DIST_PATHS`). Plan B2 against the post-B1 `main` so the umbrella edits stack cleanly.
- The breaking-change note (factories + barrel leak relocation) is recorded at the next release in the `vX-release-notes.md`, not as a rolling changelog (matching the repo's release pattern).

---

## Self-review

- **Spec coverage (PR B1 section):** factories → `/internal/runtime` (Task 2), `LoadersHandlerOptions` re-export (Task 2), `pickAccept` de-surfaced (Task 1, via extraction), server-entry codegen + tests (Task 3), umbrella + `consolidate.mjs` (Task 4), `ActionEntry` stays public (Task 2 index keeps it). All present.
- **Placeholder scan:** every code step shows the full code; commands have expected output. None pending.
- **Type/name consistency:** `pickAccept`/`Accept` (Task 1) match the import in Task 1 Step 5; the three factory names are identical across Tasks 2, 3, 4 and the `FACTORIES` test array; the subpath string `hono-preact/server/internal/runtime` is identical in Tasks 3, 4, and 5.
