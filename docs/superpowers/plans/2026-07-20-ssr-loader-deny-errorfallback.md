# SSR loader `deny()` → route `errorFallback` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an SSR loader `deny()`, render the route's `errorFallback` into a full document at the deny's status (and headers), matching client-navigation output, and hydrate it cleanly (no DOM mismatch, no refetch).

**Architecture:** Two separable mechanisms. (1) A boundary/`DataReader` change catches a loader deny in-tree during SSR and renders the nearest `errorFallback` — loader-local (with a hydration bake) or, when there is none, a tagged rethrow to the page-level `RouteBoundary`. (2) A per-request side-channel (`recordServerDeny`/`takeServerDeny`, mirroring `streaming-ssr.ts`) carries the deny status+headers so `renderPage` applies them to the finished document. A `data-loader-deny` hydration marker lets the client seed a coldError phase and skip the refetch.

**Tech Stack:** TypeScript, Preact (+ `preact-render-to-string`'s async prerender), Hono, Vitest. Monorepo: `@hono-preact/iso` (framework runtime), `@hono-preact/server` (SSR).

## Global Constraints

- **No em-dashes in prose, comments, or commit messages.** Use commas/semicolons/parentheses/colons or two sentences. (Em-dashes fine in CLI flags, code identifiers.)
- **Prefer reshaping types over `as` casts.** For a symbol-keyed property, declare the symbol on the value's type and narrow with `in` / a predicate. Sanctioned cast boundaries: parsing untrusted JSON, FormData reads, user-module structural reads.
- **TDD**: write the failing test, watch it fail, minimal implementation, watch it pass, commit.
- **Run tests from the repo root** with `pnpm exec vitest run <pattern>` (a `pnpm --filter <pkg> test` is a silent no-op: sub-packages have no `test` script).
- **Framework `dist/` must be current** before `pnpm typecheck` or any `apps/site` build resolves cross-package types (`packages/*` publish types through `dist/`). Rebuild with `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build` when types cross the iso↔server boundary.
- **`@hono-preact/server` imports iso internals only through `@hono-preact/iso/internal`** (the `packages/iso/src/internal.ts` barrel). A new internal export MUST be added there or the server import fails.
- **The iso↔server internal barrel is drift-guarded.** Adding an export to `internal.ts` may require updating the export-drift allowlist/snapshot test; run the iso test suite after touching the barrel and update the guard if it flags the new name.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/iso/src/internal/server-deny-registry.ts` | **new** — per-request deny status/headers side-channel (record/take) |
| `packages/iso/src/internal/loader-deny-mark.ts` | **new** — `LOADER_DENY` symbol + `markLoaderDeny` / `isLoaderDeny` |
| `packages/iso/src/outcomes.ts` | `DenyOutcome` gains optional `[LOADER_DENY]?: true` |
| `packages/iso/src/internal/envelope.tsx` | `HydrationAnchor` deny kind → emits `data-loader-deny` |
| `packages/iso/src/internal/preload.ts` | `getPreloadedDeny` / `deletePreloadedDeny` |
| `packages/iso/src/internal/route-boundary.tsx` | `ErrorBoundary` renders a tagged loader deny's fallback on the server + records status |
| `packages/iso/src/internal/loader.tsx` | `DataReader` deny interception + bake; client coldError re-wrap |
| `packages/iso/src/loader-state.ts` | `LoaderView` coldError variant gains `fromBakedDeny?: true` |
| `packages/iso/src/internal/use-loader-runner.tsx` | seed coldError from a baked deny; expose `fromBakedDeny` |
| `packages/iso/src/internal.ts` | barrel exports for the new server/client entry points |
| `packages/server/src/stream-pump.ts` | thread a `status` into the streamed `Response` |
| `packages/server/src/render.tsx` | `takeServerDeny()` → status + headers on both return paths |

Task order is dependency-first: leaf helpers (1, 2, 3, 4) before the consumers that wire them (5–8), server application last (9), integration test last (10).

---

### Task 1: Per-request server deny side-channel

**Files:**
- Create: `packages/iso/src/internal/server-deny-registry.ts`
- Modify: `packages/iso/src/internal.ts` (export)
- Test: `packages/iso/src/internal/__tests__/server-deny-registry.test.ts`

**Interfaces:**
- Consumes: `getRequestStore` from `../cache.js`; `ErrorStatusCode` from `../outcomes.js`.
- Produces:
  - `type ServerDenyRecord = { status: ErrorStatusCode; headers: Record<string, string> | undefined }`
  - `function recordServerDeny(record: ServerDenyRecord): void` — first-write-wins per request.
  - `function takeServerDeny(): ServerDenyRecord | null` — returns and clears.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/server-deny-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runRequestScope } from '../../cache.js';
import {
  recordServerDeny,
  takeServerDeny,
} from '../server-deny-registry.js';

describe('server-deny-registry', () => {
  it('records and takes a deny within a request scope', async () => {
    await runRequestScope(async () => {
      recordServerDeny({ status: 404, headers: { 'x-a': '1' } });
      const taken = takeServerDeny();
      expect(taken).toEqual({ status: 404, headers: { 'x-a': '1' } });
    });
  });

  it('is first-write-wins: a second record is ignored', async () => {
    await runRequestScope(async () => {
      recordServerDeny({ status: 404, headers: undefined });
      recordServerDeny({ status: 403, headers: undefined });
      expect(takeServerDeny()).toEqual({ status: 404, headers: undefined });
    });
  });

  it('take clears the slot (second take is null)', async () => {
    await runRequestScope(async () => {
      recordServerDeny({ status: 500, headers: undefined });
      expect(takeServerDeny()?.status).toBe(500);
      expect(takeServerDeny()).toBeNull();
    });
  });

  it('does not leak across request scopes', async () => {
    await runRequestScope(async () => {
      recordServerDeny({ status: 404, headers: undefined });
    });
    await runRequestScope(async () => {
      expect(takeServerDeny()).toBeNull();
    });
  });

  it('is a no-op outside any request scope', () => {
    recordServerDeny({ status: 404, headers: undefined });
    expect(takeServerDeny()).toBeNull();
  });
});
```

Verify `runRequestScope` is exported from `packages/iso/src/cache.ts` (it is — `render.tsx` and `streaming-ssr.ts` both use it via `getRequestStore`). If `runRequestScope` is not directly exported from `../../cache.js`, import it from wherever `render.tsx` imports it and adjust the path; the registry logic under test is unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/server-deny-registry.test.ts`
Expected: FAIL — cannot resolve `../server-deny-registry.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/iso/src/internal/server-deny-registry.ts` (mirrors `streaming-ssr.ts`):

```ts
import { getRequestStore } from '../cache.js';
import type { ErrorStatusCode } from '../outcomes.js';

/** The response-level facts a rendered SSR loader deny must apply to the document. */
export type ServerDenyRecord = {
  status: ErrorStatusCode;
  headers: Record<string, string> | undefined;
};

const REGISTRY_KEY = Symbol.for('@hono-preact/server-deny-registry');

/**
 * Record the deny that a rendered SSR loader `errorFallback` stands in for, so
 * `renderPage` can set the document's status + headers after prerender. FIRST
 * write wins: a page renders exactly one document, so the first deny reached in
 * prerender depth-order owns the response; later denies are ignored.
 */
export function recordServerDeny(record: ServerDenyRecord): void {
  const store = getRequestStore();
  if (!store) return; // outside any request scope (e.g. client)
  if (store.get(REGISTRY_KEY) !== undefined) return; // first-write-wins
  store.set(REGISTRY_KEY, record);
}

/**
 * Take ownership of the recorded deny for the current request, clearing it.
 * Called from `renderPage` after prerender resolves, still inside the request
 * scope. Returns null when no loader deny was rendered.
 */
export function takeServerDeny(): ServerDenyRecord | null {
  const store = getRequestStore();
  if (!store) return null;
  const record = store.get(REGISTRY_KEY) as ServerDenyRecord | undefined;
  store.set(REGISTRY_KEY, undefined);
  return record ?? null;
}
```

Add to `packages/iso/src/internal.ts` (near the `streaming-ssr.js` exports, ~line 68):

```ts
export {
  recordServerDeny,
  takeServerDeny,
} from './internal/server-deny-registry.js';
export type { ServerDenyRecord } from './internal/server-deny-registry.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/server-deny-registry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Check the internal-barrel drift guard**

Run: `pnpm exec vitest run packages/iso/src/__tests__` and scan for an export-drift / barrel-snapshot failure naming `recordServerDeny` / `takeServerDeny` / `ServerDenyRecord`. If one fails, add those names to the allowlist/snapshot it checks (see the drift-guard test file it points to) and re-run.
Expected: PASS after any allowlist update.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/server-deny-registry.ts packages/iso/src/internal.ts packages/iso/src/internal/__tests__/server-deny-registry.test.ts
git commit -m "feat(iso): per-request server deny side-channel for SSR errorFallback (#287)"
```

---

### Task 2: Loader-deny tag

**Files:**
- Create: `packages/iso/src/internal/loader-deny-mark.ts`
- Modify: `packages/iso/src/outcomes.ts` (add optional symbol field to `DenyOutcome`)
- Test: `packages/iso/src/internal/__tests__/loader-deny-mark.test.ts`

**Interfaces:**
- Consumes: `isDeny`, `DenyOutcome` from `../outcomes.js`.
- Produces:
  - `const LOADER_DENY: unique symbol`
  - `function markLoaderDeny(o: DenyOutcome): DenyOutcome` — sets the tag, returns `o`.
  - `function isLoaderDeny(x: unknown): x is DenyOutcome` — `isDeny(x)` AND tag present.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/loader-deny-mark.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deny } from '../../outcomes.js';
import {
  markLoaderDeny,
  isLoaderDeny,
} from '../loader-deny-mark.js';

describe('loader-deny-mark', () => {
  it('an untagged deny is not a loader deny', () => {
    expect(isLoaderDeny(deny(404, 'nope'))).toBe(false);
  });

  it('markLoaderDeny tags in place and returns the same object', () => {
    const d = deny(404, 'nope');
    const out = markLoaderDeny(d);
    expect(out).toBe(d);
    expect(isLoaderDeny(d)).toBe(true);
  });

  it('isLoaderDeny is false for non-deny values', () => {
    expect(isLoaderDeny(null)).toBe(false);
    expect(isLoaderDeny({ __outcome: 'redirect', to: '/x', status: 302 })).toBe(
      false
    );
    expect(isLoaderDeny(new Error('x'))).toBe(false);
  });
});
```

Confirm `deny` is exported from `packages/iso/src/outcomes.ts` (it is — the overloaded factory, `outcomes.ts:108-163`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-deny-mark.test.ts`
Expected: FAIL — cannot resolve `../loader-deny-mark.js`.

- [ ] **Step 3: Write minimal implementation**

Add the optional symbol field to `DenyOutcome` in `packages/iso/src/outcomes.ts`. Import the symbol at the top of the file:

```ts
import { LOADER_DENY } from './internal/loader-deny-mark.js';
```

Extend the `DenyOutcome` type (`outcomes.ts:45-52`) with the tag field (declaring the key avoids a cast at the read site):

```ts
export type DenyOutcome = {
  __outcome: 'deny';
  status: ErrorStatusCode;
  message: string;
  headers: Record<string, string> | undefined;
  data?: unknown;
  code?: DenyCode;
  /**
   * Server-only SSR tag: set by `DataReader` when a loader deny with no local
   * `errorFallback` is rethrown, so an outer `RouteBoundary` renders its own
   * fallback while an untagged (middleware) deny keeps unwinding to bare text.
   */
  readonly [LOADER_DENY]?: true;
};
```

Create `packages/iso/src/internal/loader-deny-mark.ts`:

```ts
import { isDeny } from '../outcomes.js';
import type { DenyOutcome } from '../outcomes.js';

/**
 * Marks a `DenyOutcome` as loader-originated. Declared on `DenyOutcome` so the
 * read is a typed `in`-style property access, not a cast. Only SSR uses it: a
 * loader deny with no local `errorFallback` is tagged before rethrow so a
 * page-level `RouteBoundary` may render its fallback; a middleware deny is never
 * tagged and stays bare text.
 */
export const LOADER_DENY: unique symbol = Symbol.for('@hono-preact/loader-deny');

/** Tag the outcome in place and return it (for `throw markLoaderDeny(e)`). */
export function markLoaderDeny(o: DenyOutcome): DenyOutcome {
  (o as { [LOADER_DENY]?: true })[LOADER_DENY] = true;
  return o;
}

/** True iff `x` is a deny outcome carrying the loader tag. */
export function isLoaderDeny(x: unknown): x is DenyOutcome {
  return isDeny(x) && x[LOADER_DENY] === true;
}
```

Note on the one cast in `markLoaderDeny`: writing a `readonly` symbol field is the mutation the tag needs; the local widening `{ [LOADER_DENY]?: true }` writes exactly that declared field (no shape invention). The read in `isLoaderDeny` needs no cast because `isDeny(x)` narrows `x` to `DenyOutcome`, on which `[LOADER_DENY]` is declared. If circular-import ordering between `outcomes.ts` and `loader-deny-mark.ts` causes `LOADER_DENY` to be `undefined` at module-eval time (it is a `Symbol.for`, evaluated at first access, so this is unlikely), move the `Symbol.for(...)` constant into `outcomes.ts` and re-export it from `loader-deny-mark.ts` instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-deny-mark.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck the outcomes change**

Run: `pnpm --filter @hono-preact/iso exec tsc --noEmit`
Expected: no errors (the `DenyOutcome` field is optional, so existing constructors are unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/loader-deny-mark.ts packages/iso/src/outcomes.ts packages/iso/src/internal/__tests__/loader-deny-mark.test.ts
git commit -m "feat(iso): loader-deny tag to distinguish loader vs middleware denies (#287)"
```

---

### Task 3: `HydrationAnchor` deny kind → `data-loader-deny`

**Files:**
- Modify: `packages/iso/src/internal/envelope.tsx:8-10` (type), `:32-33` and `:70` (attribute emission)
- Test: `packages/iso/src/internal/__tests__/envelope-deny-anchor.test.tsx`

**Interfaces:**
- Produces: `HydrationAnchor` union gains `| { kind: 'deny'; message: string }`. An `Envelope` with a deny anchor emits `data-loader-deny={JSON.stringify({ message })}` and NO `data-loader` attribute.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/envelope-deny-anchor.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { LoaderIdContext } from '../contexts.js';
import { Envelope } from '../envelope.js';

describe('Envelope deny anchor', () => {
  it('emits data-loader-deny and no data-loader for a deny anchor', () => {
    const html = renderToString(
      <LoaderIdContext.Provider value="L1">
        <Envelope anchor={{ kind: 'deny', message: 'No project named nope.' }}>
          <p>denied</p>
        </Envelope>
      </LoaderIdContext.Provider>
    );
    expect(html).toContain('data-loader-deny="');
    expect(html).toContain('No project named nope.');
    expect(html).not.toContain('data-loader="');
  });

  it('still emits data-loader for a data anchor', () => {
    const html = renderToString(
      <LoaderIdContext.Provider value="L2">
        <Envelope anchor={{ kind: 'data', value: { a: 1 } }}>
          <p>ok</p>
        </Envelope>
      </LoaderIdContext.Provider>
    );
    expect(html).toContain('data-loader="');
    expect(html).not.toContain('data-loader-deny');
  });
});
```

Confirm the `LoaderIdContext` import path: `envelope.tsx` imports it from `./contexts.js` (`envelope.tsx:5`), so the test uses the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/envelope-deny-anchor.test.tsx`
Expected: FAIL — the deny case currently falls into the `else` and emits `data-loader="null"`; `data-loader-deny` is absent.

- [ ] **Step 3: Write minimal implementation**

In `packages/iso/src/internal/envelope.tsx`, extend the type (`:8-10`):

```ts
export type HydrationAnchor =
  | { kind: 'none' }
  | { kind: 'data'; value: unknown }
  | { kind: 'deny'; message: string };
```

Replace the `dataLoader` computation (`:31-33`) and the `h(...)` return (`:70`). The deny case emits a distinct attribute so a legitimately-baked object value in `data-loader` can never be misread as a deny, and vice versa:

```ts
  // A deny anchor rides a SEPARATE attribute: the client reads it BEFORE
  // `data-loader`, seeds a coldError, and skips the fetch. A denied loader
  // writes NO `data-loader` (so `getPreloadedData` reports absent for it).
  const denyAttr =
    anchor.kind === 'deny'
      ? JSON.stringify({ message: anchor.message })
      : undefined;
  // Coerce undefined -> null so JSON.stringify(undefined) never reaches the wire.
  const dataLoader =
    anchor.kind === 'data' ? JSON.stringify(anchor.value ?? null) : 'null';
```

Then the return (`:70`) becomes (build the attribute bag so the deny case omits `data-loader` entirely):

```ts
  const attrs: Record<string, unknown> =
    anchor.kind === 'deny'
      ? { id, 'data-loader-deny': denyAttr, ref: setLive }
      : { id, 'data-loader': dataLoader, ref: setLive };
  return h(as, attrs, children);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/envelope-deny-anchor.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Regression — existing envelope/loader DOM tests**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__ packages/iso/src/__tests__`
Expected: PASS. If any test asserted the exact attribute set of a rendered `<section>`, confirm it used a `data` or `none` anchor (unchanged) — the deny branch is new and no prior test exercises it.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/envelope.tsx packages/iso/src/internal/__tests__/envelope-deny-anchor.test.tsx
git commit -m "feat(iso): HydrationAnchor deny kind emits data-loader-deny (#287)"
```

---

### Task 4: `getPreloadedDeny` / `deletePreloadedDeny`

**Files:**
- Modify: `packages/iso/src/internal/preload.ts`, `packages/iso/src/internal.ts` (export `getPreloadedDeny`)
- Test: `packages/iso/src/internal/__tests__/preload-deny.test.ts`

**Interfaces:**
- Produces:
  - `type PreloadedDeny = { present: false } | { present: true; message: string }`
  - `function getPreloadedDeny(id: string): PreloadedDeny` — reads `data-loader-deny`; browser-only (returns absent on the server).
  - `function deletePreloadedDeny(id: string): void` — clears the attribute.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/preload-deny.test.ts` (jsdom):

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPreloadedDeny,
  deletePreloadedDeny,
} from '../preload.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('getPreloadedDeny', () => {
  it('reads a present deny marker', () => {
    const el = document.createElement('section');
    el.id = 'L1';
    el.dataset.loaderDeny = JSON.stringify({ message: 'nope' });
    document.body.appendChild(el);
    expect(getPreloadedDeny('L1')).toEqual({ present: true, message: 'nope' });
  });

  it('reports absent when the element or attribute is missing', () => {
    expect(getPreloadedDeny('missing')).toEqual({ present: false });
    const el = document.createElement('section');
    el.id = 'L2';
    document.body.appendChild(el);
    expect(getPreloadedDeny('L2')).toEqual({ present: false });
  });

  it('reports absent on malformed JSON', () => {
    const el = document.createElement('section');
    el.id = 'L3';
    el.dataset.loaderDeny = '{not json';
    document.body.appendChild(el);
    expect(getPreloadedDeny('L3')).toEqual({ present: false });
  });

  it('deletePreloadedDeny clears the attribute', () => {
    const el = document.createElement('section');
    el.id = 'L4';
    el.dataset.loaderDeny = JSON.stringify({ message: 'x' });
    document.body.appendChild(el);
    deletePreloadedDeny('L4');
    expect('loaderDeny' in el.dataset).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/preload-deny.test.ts`
Expected: FAIL — `getPreloadedDeny` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/iso/src/internal/preload.ts` (reuse the existing `isBrowser` import already at the top of that file):

```ts
/** Present/absent carrier for the SSR-baked loader deny marker. */
export type PreloadedDeny =
  | { present: false }
  | { present: true; message: string };

/**
 * Pure read of the SSR'd `data-loader-deny` marker for a loader. Browser-only
 * (absent on the server). A present marker means the loader denied during SSR
 * and its `errorFallback` is already in the server DOM; the client seeds a
 * coldError from `message` and skips the fetch. The caller schedules
 * `deletePreloadedDeny` in an effect after consuming it.
 */
export function getPreloadedDeny(id: string): PreloadedDeny {
  if (!isBrowser()) return { present: false };
  const el = document.getElementById(id);
  if (!el || !('loaderDeny' in el.dataset)) return { present: false };
  try {
    // Untrusted SSR payload: parsing JSON is the sanctioned cast boundary.
    const parsed = JSON.parse(el.dataset.loaderDeny ?? 'null') as {
      message?: unknown;
    } | null;
    const message = typeof parsed?.message === 'string' ? parsed.message : '';
    return { present: true, message };
  } catch {
    return { present: false };
  }
}

export function deletePreloadedDeny(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  delete el.dataset.loaderDeny;
}
```

Add to `packages/iso/src/internal.ts` (beside the existing `getPreloadedData` export at ~line 37):

```ts
export { getPreloadedDeny, deletePreloadedDeny } from './internal/preload.js';
export type { PreloadedDeny } from './internal/preload.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/preload-deny.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Barrel drift guard**

Run: `pnpm exec vitest run packages/iso/src/__tests__`
Expected: PASS; if the export-drift guard flags `getPreloadedDeny` / `deletePreloadedDeny` / `PreloadedDeny`, add them to its allowlist and re-run.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/preload.ts packages/iso/src/internal.ts packages/iso/src/internal/__tests__/preload-deny.test.ts
git commit -m "feat(iso): getPreloadedDeny reads the SSR deny hydration marker (#287)"
```

---

### Task 5: `ErrorBoundary` renders a tagged loader deny on the server

**Files:**
- Modify: `packages/iso/src/internal/route-boundary.tsx`
- Test: `packages/iso/src/internal/__tests__/route-boundary-deny.test.tsx`

**Interfaces:**
- Consumes: `isLoaderDeny` (Task 2), `recordServerDeny` (Task 1), `isBrowser`, `isOutcome`, `toError`.
- Produces: on the SERVER, an `ErrorBoundary` whose child throws a *tagged* loader deny records the deny (status+headers) and renders its `fallback(Error(message), reset)`; with no `fallback` it rethrows. Redirect/render outcomes and untagged (middleware) denies still rethrow. Client behavior unchanged.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/route-boundary-deny.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { runRequestScope } from '../../cache.js';
import { deny } from '../../outcomes.js';
import { markLoaderDeny } from '../loader-deny-mark.js';
import { takeServerDeny } from '../server-deny-registry.js';
import { RouteBoundary } from '../route-boundary.js';

// A child that throws on render.
function Thrower({ error }: { error: unknown }): never {
  throw error;
}

describe('RouteBoundary server deny handling', () => {
  it('renders the fallback and records a tagged loader deny (server)', async () => {
    await runRequestScope(async () => {
      const html = renderToString(
        <RouteBoundary
          errorFallback={(e: Error) => <p class="fb">{e.message}</p>}
        >
          <Thrower error={markLoaderDeny(deny(404, 'gone'))} />
        </RouteBoundary>
      );
      expect(html).toContain('class="fb"');
      expect(html).toContain('gone');
      expect(takeServerDeny()).toEqual({ status: 404, headers: undefined });
    });
  });

  it('rethrows a tagged loader deny when there is no fallback', async () => {
    await runRequestScope(async () => {
      expect(() =>
        renderToString(
          <RouteBoundary>
            <Thrower error={markLoaderDeny(deny(403, 'no'))} />
          </RouteBoundary>
        )
      ).toThrow();
      expect(takeServerDeny()).toBeNull();
    });
  });

  it('rethrows an UNTAGGED (middleware) deny even with a fallback', async () => {
    await runRequestScope(async () => {
      expect(() =>
        renderToString(
          <RouteBoundary errorFallback={<p>fb</p>}>
            <Thrower error={deny(403, 'mw')} />
          </RouteBoundary>
        )
      ).toThrow();
      expect(takeServerDeny()).toBeNull();
    });
  });

  it('still renders the fallback for a plain Error', async () => {
    await runRequestScope(async () => {
      const html = renderToString(
        <RouteBoundary errorFallback={(e: Error) => <p class="fb">{e.message}</p>}>
          <Thrower error={new Error('boom')} />
        </RouteBoundary>
      );
      expect(html).toContain('boom');
      expect(takeServerDeny()).toBeNull();
    });
  });
});
```

If `renderToString` does not drive the error-boundary path the same way the async prerender does, switch this test to `renderToStringAsync` from `preact-render-to-string` (the server render path in `render.tsx` uses the async prerender). Keep the assertions identical.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/route-boundary-deny.test.tsx`
Expected: FAIL — today the boundary rethrows ALL outcomes, so test 1 throws instead of rendering the fallback, and `takeServerDeny()` is null.

- [ ] **Step 3: Write minimal implementation**

Rewrite `packages/iso/src/internal/route-boundary.tsx`. Add imports and thread a `deny` field through boundary state:

```tsx
import { Component } from 'preact';
import type { ComponentChildren, FunctionComponent } from 'preact';
import { isOutcome } from '../outcomes.js';
import type { DenyOutcome } from '../outcomes.js';
import { isBrowser } from '../is-browser.js';
import { isLoaderDeny } from './loader-deny-mark.js';
import { recordServerDeny } from './server-deny-registry.js';
import { toError } from './to-error.js';

type ErrorFallback =
  | ComponentChildren
  | ((error: Error, reset: () => void) => ComponentChildren);

type ErrorBoundaryProps = {
  fallback?: ErrorFallback;
  children: ComponentChildren;
};

type ErrorBoundaryState = { error: Error | null; deny: DenyOutcome | null };

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, deny: null };

  // Outcomes are control-flow, not errors. A SERVER-side, loader-tagged deny is
  // the one exception we may render (as the route's errorFallback at the deny
  // status); render() decides based on whether a fallback exists. Everything
  // else - the client, a redirect/render outcome, or an untagged middleware
  // deny - rethrows so renderPage's outer catch translates it (a middleware
  // deny stays bare text, matching the client where it never reaches a
  // fallback). The same guard lives in componentDidCatch because Preact may
  // invoke both hooks; whichever fires first must not swallow.
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    if (isOutcome(error)) {
      if (!isBrowser() && isLoaderDeny(error)) {
        return { error: toError(error), deny: error };
      }
      throw error;
    }
    return { error: toError(error), deny: null };
  }

  componentDidCatch(error: unknown) {
    if (isOutcome(error) && !(!isBrowser() && isLoaderDeny(error))) throw error;
  }

  reset = () => {
    this.setState({ error: null, deny: null });
  };

  render() {
    const { error, deny } = this.state;
    if (!error) return this.props.children;
    const f = this.props.fallback;
    if (deny) {
      // No fallback here: unwind to an outer boundary (which may have one).
      if (f == null) throw deny;
      // Record the response facts so renderPage sets the document status.
      recordServerDeny({ status: deny.status, headers: deny.headers });
    }
    if (typeof f === 'function') return f(error, this.reset);
    if (f) return f;
    return null;
  }
}

export const RouteBoundary: FunctionComponent<{
  errorFallback?: ErrorFallback;
  children: ComponentChildren;
}> = ({ errorFallback, children }) => (
  <ErrorBoundary fallback={errorFallback}>{children}</ErrorBoundary>
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/route-boundary-deny.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Regression — existing boundary + render tests**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/route-boundary`
Expected: PASS (any pre-existing route-boundary tests). The client path is unchanged and untagged/redirect outcomes still rethrow.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/route-boundary.tsx packages/iso/src/internal/__tests__/route-boundary-deny.test.tsx
git commit -m "feat(iso): RouteBoundary renders a tagged loader deny's fallback on the server (#287)"
```

---

### Task 6: `DataReader` loader-local deny interception + hydration bake

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx` (`DataReader` `:53-90`; thread `errorFallback` from `LoaderHost` at `:199-207`)
- Test: `packages/iso/src/internal/__tests__/data-reader-deny.test.tsx`

**Interfaces:**
- Consumes: `isDeny` (`../outcomes.js`), `markLoaderDeny` (Task 2), `recordServerDeny` (Task 1), `toError`, `Envelope`, `HydrationAnchor` (Task 3).
- Produces: on the SERVER, a `DataReader` whose `reader.read()` throws a deny either (a) records the deny and renders `errorFallback` wrapped in an `<Envelope anchor={{kind:'deny',message}}>` when a local `errorFallback` is present, or (b) tags the deny and rethrows when absent. Pending-promise and non-deny throws are rethrown unchanged.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/data-reader-deny.test.tsx`. Drive it through `LoaderHost` on the server with a loader whose fn denies, so the test exercises the real wiring (not a hand-built `DataReader`). Use the existing loader test helpers if the repo has them; otherwise build a minimal server render. A minimal, self-contained version:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStringAsync } from 'preact-render-to-string';
import { runRequestScope } from '../../cache.js';
import { deny } from '../../outcomes.js';
import { takeServerDeny } from '../server-deny-registry.js';
import { defineLoader } from '../../define-loader.js';

// A loader that always denies. `defineLoader` shape: confirm the exact factory
// signature in packages/iso/src/define-loader.ts and adjust the call to match
// how other loader tests (e.g. loader-runner-c.test.tsx) construct one.
const denyingLoader = defineLoader(async () => {
  throw deny(404, "No project named 'nope'.");
});

describe('DataReader loader-local deny (server)', () => {
  it('renders the local errorFallback and records the deny', async () => {
    await runRequestScope(async () => {
      const html = await renderToStringAsync(
        <denyingLoader.View
          errorFallback={(e: Error) => (
            <div class="panel">Board error: {e.message}</div>
          )}
        >
          {() => <div>never</div>}
        </denyingLoader.View>
      );
      expect(html).toContain('class="panel"');
      expect(html).toContain("No project named 'nope'.");
      // Baked for hydration:
      expect(html).toContain('data-loader-deny="');
      // Response facts recorded:
      expect(takeServerDeny()).toEqual({ status: 404, headers: undefined });
    });
  });

  it('rethrows (tagged) when there is no local errorFallback', async () => {
    await runRequestScope(async () => {
      await expect(
        renderToStringAsync(
          <denyingLoader.View>{() => <div>never</div>}</denyingLoader.View>
        )
      ).rejects.toBeTruthy();
      // Not recorded by the loader itself; an outer boundary/renderPage handles it.
      expect(takeServerDeny()).toBeNull();
    });
  });
});
```

Before writing, open `packages/iso/src/__tests__/loader-runner-c.test.tsx` (it already renders denying loaders on the server, `:203-253`) and copy its exact `defineLoader` / `.View` construction so this test matches the real API. Adjust the two `denyingLoader.View` usages accordingly. The assertions stay the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/data-reader-deny.test.tsx`
Expected: FAIL — today the loader-local deny unwinds out of the render (no fallback rendered, `takeServerDeny()` null), so test 1's first assertion fails / the render rejects.

- [ ] **Step 3: Write minimal implementation**

In `packages/iso/src/internal/loader.tsx`, add imports at the top:

```ts
import { isDeny } from '../outcomes.js';
import { markLoaderDeny } from './loader-deny-mark.js';
import { recordServerDeny } from './server-deny-registry.js';
// `toError` and `Envelope`/`HydrationAnchor` are already imported in this file;
// confirm and add any that are missing.
```

Extend `DataReader`'s props and body (`:53-90`). Add `errorFallback` to the prop type and wrap `reader.read()`:

```tsx
function DataReader<T>({
  reader,
  accumulate,
  errorFallback,
  children,
}: {
  reader: { read: () => T };
  accumulate?: AccumulateOptions;
  errorFallback?:
    | ComponentChildren
    | ((err: Error, reset: () => void) => ComponentChildren);
  children: ComponentChildren;
}) {
  let raw: T;
  try {
    raw = reader.read();
  } catch (e) {
    // A pending promise (Suspense) or any non-deny throw: rethrow unchanged so
    // renderToStringAsync suspends / an outer boundary handles a plain error.
    if (!isDeny(e)) throw e;
    // A loader deny with no LOCAL errorFallback: tag it and rethrow so an outer
    // page-level RouteBoundary may render ITS fallback (Task 5); an untagged
    // middleware deny would not.
    if (errorFallback == null) throw markLoaderDeny(e);
    // Loader-local deny WITH a fallback: record the response facts and render
    // the fallback wrapped in an Envelope carrying the deny marker, so the
    // client seeds a coldError on hydration instead of refetching.
    recordServerDeny({ status: e.status, headers: e.headers });
    const err = toError(e);
    const rendered =
      typeof errorFallback === 'function'
        ? // On the server there is no client runner to reset; the real reload is
          // wired on hydration. A noop keeps the (error, reset) signature.
          errorFallback(err, NOOP_RESET)
        : errorFallback;
    return (
      <Envelope anchor={{ kind: 'deny', message: e.message }}>
        {rendered}
      </Envelope>
    );
  }
  // ...existing success path unchanged (state/anchor/return at :79-89)...
}

const NOOP_RESET = () => {};
```

Thread `errorFallback` into `DataReader` where `LoaderHost` builds the server `content` (`:203-207`):

```tsx
  ) : (
    <DataReader reader={reader} accumulate={accumulate} errorFallback={errorFallback}>
      {children}
    </DataReader>
  );
```

Note: when the loader HAS a local `errorFallback`, `LoaderHost` also wraps `content` in an `<ErrorBoundary fallback={errorFallback}>` (`:229`). `DataReader` now intercepts the deny FIRST (its own `read()` throw), so that wrap never sees the deny and there is no double-record. When the loader has NO local `errorFallback`, `content` is bare (`:231`); `DataReader` tags + rethrows and the deny bubbles past `LoaderHost` to the page-level `RouteBoundary`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/data-reader-deny.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Regression — loader server tests**

Run: `pnpm exec vitest run packages/iso/src/__tests__/loader-runner-c.test.tsx packages/iso/src/internal/__tests__`
Expected: PASS. The success/streaming paths of `DataReader` are untouched; only the catch arm is new.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/internal/__tests__/data-reader-deny.test.tsx
git commit -m "feat(iso): SSR loader-local deny renders errorFallback + bakes hydration marker (#287)"
```

---

### Task 7: Client seed — coldError from the baked deny (no refetch)

**Files:**
- Modify: `packages/iso/src/loader-state.ts:65-67` (add `fromBakedDeny?: true` to the `coldError` variant), `packages/iso/src/internal/use-loader-runner.tsx`
- Test: `packages/iso/src/internal/__tests__/loader-runner-baked-deny.test.tsx`

**Interfaces:**
- Consumes: `getPreloadedDeny`, `deletePreloadedDeny` (Task 4).
- Produces: on the client's FIRST render, if `getPreloadedDeny(id)` is present, the runner's `view` is `{ kind: 'coldError', error: Error(message), fromBakedDeny: true }` with NO loader fetch issued; `reload()` clears the seed and runs a real fetch. The DOM attribute is cleared after commit.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/loader-runner-baked-deny.test.tsx` (jsdom). Render a loader `.View` with an `errorFallback` into a container pre-seeded with the `data-loader-deny` attribute under the loader's id, and assert the fallback renders without a fetch. Because the loader id is a `useId()` decided at render time, drive it through `LoaderHost`/`.View` and pre-seed the attribute by intercepting the first render, OR assert at the runner level. The robust approach asserts observable behavior through `.View`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'preact';

beforeEach(() => {
  document.body.innerHTML = '';
});

// Spy on the loader fetch path so we can assert NO network call happens.
// Confirm the exact module + export used by the cold-fetch path
// (`runLoader` from '../loader-runner.js', used at use-loader-runner.tsx:230,421).
vi.mock('../loader-runner.js', async (orig) => {
  const actual = await orig<typeof import('../loader-runner.js')>();
  return { ...actual, runLoader: vi.fn(actual.runLoader) };
});

import { runLoader } from '../loader-runner.js';
import { defineLoader } from '../../define-loader.js';

describe('client seed from baked deny', () => {
  it('renders errorFallback without fetching when data-loader-deny is present', async () => {
    // Pre-seed the DOM: the loader's Envelope id is a useId; to make it
    // deterministic, render once to discover the id, then re-seed. Simpler:
    // wrap in a container whose only loader is this one, find the rendered
    // section, set data-loader-deny, and re-render (hydrate). See note below.
    const l = defineLoader(async () => ({ ok: true }));
    const container = document.createElement('div');
    document.body.appendChild(container);

    // First render to obtain the loader element id.
    render(
      <l.View errorFallback={(e: Error) => <p class="fb">{e.message}</p>}>
        {() => <div>ok</div>}
      </l.View>,
      container
    );
    const section = container.querySelector('[data-loader], [id]');
    expect(section).toBeTruthy();

    // Seed a deny marker under that id and force a fresh mount.
    (runLoader as unknown as { mockClear: () => void }).mockClear();
    section!.setAttribute('data-loader-deny', JSON.stringify({ message: 'gone' }));
    section!.removeAttribute('data-loader');

    render(null, container);
    section!.id && document.body.appendChild(section!); // keep id findable
    // Re-mount a fresh View; getPreloadedDeny reads by id at first render.
    // (If the id differs on remount, assert at the runner unit level instead —
    // see the alternative below.)
  });
});
```

**This DOM-timing test is fragile because `useId` is not stable across separate `render()` calls.** Prefer a **runner-level unit test** that calls `useLoaderRunner` inside a tiny harness component with a FIXED `id` and a pre-seeded attribute. Use `@testing-library/preact` if available in the repo, or a minimal manual harness:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'preact';
import { useLoaderRunner } from '../use-loader-runner.js';

vi.mock('../loader-runner.js', async (orig) => {
  const actual = await orig<typeof import('../loader-runner.js')>();
  return { ...actual, runLoader: vi.fn(actual.runLoader) };
});
import { runLoader } from '../loader-runner.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

function Harness({ loaderRef }: { loaderRef: any }) {
  const { view } = useLoaderRunner(loaderRef, {} as any, 'FIXED_ID', undefined);
  if (view.kind === 'coldError') {
    return <p class="fb" data-baked={String(view.fromBakedDeny === true)}>{view.error.message}</p>;
  }
  return <p class="loading">loading</p>;
}

describe('useLoaderRunner baked deny seed', () => {
  it('seeds coldError from data-loader-deny and does not fetch', () => {
    // Seed the attribute under the FIXED id BEFORE mount.
    const el = document.createElement('section');
    el.id = 'FIXED_ID';
    el.setAttribute('data-loader-deny', JSON.stringify({ message: 'gone' }));
    document.body.appendChild(el);

    const container = document.createElement('div');
    document.body.appendChild(container);

    // Minimal loaderRef shape the runner needs (mirror loader-runner-c.test.tsx
    // helpers). `__id`, `params`, `cache`, `live` are read by the runner; supply
    // the minimum. Confirm exact fields in define-loader.ts / LoaderRef.
    const loaderRef = {
      __id: 'x',
      params: {},
      live: false,
      cache: { get: () => undefined, set: () => {}, has: () => false },
      fn: async () => ({ ok: true }),
    } as any;

    render(<Harness loaderRef={loaderRef} />, container);

    expect(container.querySelector('.fb')?.textContent).toBe('gone');
    expect(container.querySelector('.fb')?.getAttribute('data-baked')).toBe('true');
    expect(runLoader).not.toHaveBeenCalled();
  });
});
```

Confirm the exact `LoaderRef` fields the runner reads (`loaderRef.__id`, `loaderRef.params`, `loaderRef.cache`, `loaderRef.live`, `loaderRef.fn`) against `packages/iso/src/define-loader.ts` and `use-loader-runner.tsx`, and fill the harness `loaderRef` to satisfy them. If the repo already has a `makeLoaderRef` test helper, use it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-runner-baked-deny.test.tsx`
Expected: FAIL — the runner ignores `data-loader-deny` today: `view.kind` is `render`/`loading` (or a fetch is issued), not `coldError` with `fromBakedDeny`.

- [ ] **Step 3: Write minimal implementation**

First, extend the view type in `packages/iso/src/loader-state.ts` (`:65-67`):

```ts
export type LoaderView<T> =
  | { kind: 'render'; state: LoaderState<T> }
  | { kind: 'coldError'; error: Error; fromBakedDeny?: true };
```

Then in `packages/iso/src/internal/use-loader-runner.tsx`:

Add the import (beside the existing `getPreloadedData` import at `:5`):

```ts
import {
  getPreloadedData,
  deletePreloadedData,
  getPreloadedDeny,
  deletePreloadedDeny,
} from './preload.js';
```

Add refs near the other refs (after `preloadClearedRef`, ~`:119`):

```ts
  // SSR-baked deny seed: set on the first client render when a `data-loader-deny`
  // marker is present. While set, the view projects a coldError from it and NO
  // fetch runs. A reload() clears it so a real fetch takes over.
  const bakedDenyRef = useRef<Error | null>(null);
  const denyConsumedRef = useRef(false);
  const denyClearedRef = useRef(false);
  useEffect(() => {
    if (denyConsumedRef.current && !denyClearedRef.current) {
      denyClearedRef.current = true;
      deletePreloadedDeny(id);
    }
  });
```

Clear the seed at the top of `runReload` (find the `runReload` definition ~`:188`, immediately before `inFlightRef.current = true;` at `:190`) so any reload supersedes the baked deny:

```ts
    // A reload supersedes the SSR-baked deny: drop the seed so the view projects
    // from the real phase (loading -> success/coldError) as the refetch runs.
    bakedDenyRef.current = null;
```

Seed on the first render, in the single-value reader-build block (the `else` at `:364`, right after `isFirstRender` is computed at `:477` but BEFORE the preload/cache/coldfetch dispatch). Insert immediately before `const preloaded: SyncValue<T> = ...` (`:478`):

```ts
      // Baked-deny seed takes precedence over any value preload/cache/fetch: a
      // denied loader wrote NO `data-loader`, only `data-loader-deny`.
      const bakedDeny =
        isFirstRender && isBrowser()
          ? getPreloadedDeny(id)
          : ({ present: false } as const);
      if (bakedDeny.present) {
        denyConsumedRef.current = true;
        bakedDenyRef.current = new Error(bakedDeny.message);
        // Stub reader: the client never reads it; reload() rebuilds a real one.
        readerRef.current = { read: () => undefined as unknown as T };
      } else {
```

...and close that new `else` around the existing preload/cache/coldfetch dispatch (`:478-487`), so the existing three-way only runs when there is no baked deny. Re-indent the existing block one level inside the new `else { ... }`.

Finally, override the projected `view` for the seed. After `view` is built (`:500-511`), before `return`:

```ts
  const finalView: RunnerView<T> =
    bakedDenyRef.current !== null
      ? { kind: 'coldError', error: bakedDenyRef.current, fromBakedDeny: true }
      : view;

  return {
    view: finalView,
    reload,
    reloading,
    reader: readerRef.current,
  };
```

(Replace the existing `view` in the returned object with `finalView`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-runner-baked-deny.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + runner regression**

Run: `pnpm --filter @hono-preact/iso exec tsc --noEmit`
Then: `pnpm exec vitest run packages/iso/src/__tests__/loader-runner-c.test.tsx packages/iso/src/internal/__tests__`
Expected: no type errors; existing runner tests PASS (the seed only fires when `data-loader-deny` is present, which no prior test sets).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/loader-state.ts packages/iso/src/internal/use-loader-runner.tsx packages/iso/src/internal/__tests__/loader-runner-baked-deny.test.tsx
git commit -m "feat(iso): client seeds coldError from SSR baked deny, skips refetch (#287)"
```

---

### Task 8: Client coldError re-wrap for hydration parity

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx` (`LoaderHost` coldError branch, `:210-223`)
- Test: `packages/iso/src/internal/__tests__/loader-host-baked-deny-dom.test.tsx`

**Interfaces:**
- Consumes: `view.fromBakedDeny` (Task 7), `Envelope` + deny `HydrationAnchor` (Task 3).
- Produces: when `view.fromBakedDeny`, the client wraps the rendered `errorFallback` in `<Envelope anchor={{kind:'deny',message}}>` (matching the server DOM from Task 6); a pure client-nav coldError stays bare.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/loader-host-baked-deny-dom.test.tsx`. Reuse the Task 7 harness pattern (fixed id + pre-seeded `data-loader-deny`) but render through the real `.View` so `LoaderHost`'s coldError branch runs, and assert the client DOM carries the same `data-loader-deny` wrapper the server emits:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { defineLoader } from '../../define-loader.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('client coldError re-wrap (baked deny)', () => {
  it('wraps the fallback in an Envelope carrying data-loader-deny', () => {
    // Pre-seed under the id LoaderHost will use. Because useId is render-time,
    // assert via a full mount+seed cycle OR use the runner-level harness from
    // Task 7 extended to render <Envelope> from LoaderHost. Concretely: mount
    // once, capture the loader section id, seed the attribute, and re-mount.
    // If useId instability makes that flaky, assert the branch directly by
    // checking that a coldError view with fromBakedDeny renders an element
    // carrying data-loader-deny (mirror the Task 7 Harness but render the real
    // <l.View>).
    const l = defineLoader(async () => ({ ok: true }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(
      <l.View errorFallback={(e: Error) => <p class="fb">{e.message}</p>}>
        {() => <div>ok</div>}
      </l.View>,
      container
    );
    // Discover id, seed deny, force fresh mount under same id.
    const first = container.querySelector('[data-loader]') as HTMLElement | null;
    expect(first).toBeTruthy();
    const id = first!.id;

    render(null, container);
    const seed = document.createElement('section');
    seed.id = id;
    seed.setAttribute('data-loader-deny', JSON.stringify({ message: 'gone' }));
    // Not strictly needed in-tree; getPreloadedDeny reads document.getElementById.
    document.body.appendChild(seed);

    render(
      <l.View errorFallback={(e: Error) => <p class="fb">{e.message}</p>}>
        {() => <div>ok</div>}
      </l.View>,
      container
    );

    const wrapper = container.querySelector('[data-loader-deny]');
    expect(wrapper).toBeTruthy();
    expect(container.querySelector('.fb')?.textContent).toBe('gone');
  });
});
```

If `useId` instability makes the id-discovery approach flaky in the harness, fall back to the runner-level assertion: extend the Task 7 `Harness` to render `LoaderHost`'s coldError output shape (`<Envelope anchor={{kind:'deny',message}}>{fallback}</Envelope>` when `fromBakedDeny`) and assert `[data-loader-deny]` is present. Keep the message assertion identical. The behavioral contract under test is: **fromBakedDeny coldError ⇒ the fallback is wrapped in a `data-loader-deny` Envelope**.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-host-baked-deny-dom.test.tsx`
Expected: FAIL — today the coldError branch renders the fallback bare (`loader.tsx:214-217`), so `[data-loader-deny]` is absent on the client.

- [ ] **Step 3: Write minimal implementation**

In `packages/iso/src/internal/loader.tsx`, the coldError branch (`:210-223`). Wrap the rendered fallback in an `Envelope` when `view.fromBakedDeny`:

```tsx
  let body: ComponentChildren;
  if (view.kind === 'coldError') {
    if (errorFallback != null) {
      const rendered =
        typeof errorFallback === 'function'
          ? errorFallback(view.error, reload)
          : errorFallback;
      // Hydration parity: a baked-deny coldError re-wraps the fallback in the
      // SAME Envelope the server emitted (Task 6), so the hydrated DOM matches
      // and no mismatch/refetch occurs. A pure client-nav coldError stays bare.
      body = view.fromBakedDeny ? (
        <Envelope anchor={{ kind: 'deny', message: view.error.message }}>
          {rendered}
        </Envelope>
      ) : (
        rendered
      );
    } else {
      throw view.error;
    }
  } else if (errorFallback != null) {
    body = <ErrorBoundary fallback={errorFallback}>{content}</ErrorBoundary>;
  } else {
    body = content;
  }
```

`Envelope` reads its id from `LoaderIdContext`, provided by `LoaderHost`'s return wrap (`:235`), so both sides mount under the same `useId`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-host-baked-deny-dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Regression — loader DOM/hydration tests**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__ packages/iso/src/__tests__/loader-runner-c.test.tsx`
Expected: PASS. Client-nav coldError (no `fromBakedDeny`) is unchanged (still bare).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/internal/__tests__/loader-host-baked-deny-dom.test.tsx
git commit -m "feat(iso): client re-wraps baked-deny coldError in matching Envelope (#287)"
```

---

### Task 9: `renderPage` applies the recorded deny status + headers

**Files:**
- Modify: `packages/server/src/render.tsx` (~`:191-192`, and the streaming return `:266`), `packages/server/src/stream-pump.ts` (`streamDocumentResponse` opts + `c.body(...)` status)
- Test: `packages/server/src/__tests__/render-loader-deny.test.tsx`

**Interfaces:**
- Consumes: `takeServerDeny`, `ServerDenyRecord` from `@hono-preact/iso/internal` (Task 1); `applyOutcomeHeaders` from `./outcome-translation.js`.
- Produces: after prerender, `renderPage` applies the recorded deny's `status` + `headers` to BOTH the non-streaming (`c.html`) and streaming (`streamDocumentResponse`) responses. `streamDocumentResponse` gains an optional `status?: ContentfulStatusCode` (default 200).

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/render-loader-deny.test.tsx`. Build a page whose loader denies during SSR and assert a full document at the deny status. Mirror the loader/`.View` construction from `packages/iso/src/__tests__/loader-runner-c.test.tsx` and the `renderPage` harness from `render-honocontext.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { defineLoader } from '@hono-preact/iso';
import { renderPage } from '../render.js';

const board = defineLoader(async () => {
  throw (await import('@hono-preact/iso')).deny(404, "No project named 'nope'.");
});

const Layout = () => (
  <html>
    <body>
      <board.View
        errorFallback={(e: Error) => <div class="panel">Board error: {e.message}</div>}
      >
        {() => <div>never</div>}
      </board.View>
    </body>
  </html>
);

describe('SSR loader deny renders errorFallback at the deny status', () => {
  it('returns a full document with the branded fallback at 404', async () => {
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/demo/projects/nope');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('class="panel"');
    expect(body).toContain("No project named 'nope'.");
    // Baked for hydration:
    expect(body).toContain('data-loader-deny="');
  });
});
```

Confirm the `defineLoader`/`.View` API and whether a route-bound loader needs a `location`; `board.View` here is a route-independent loader (bare `defineLoader`), which renders without a route per `loader.tsx:129-132`. If `defineLoader`/`deny` are not both re-exported from `@hono-preact/iso`, import `deny` from wherever the other tests import it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/__tests__/render-loader-deny.test.tsx`
Expected: FAIL — before Task 9 wires `takeServerDeny`, the document renders (Task 6 rendered the fallback) but at HTTP **200**, so `res.status` is 200 not 404.

Note: Tasks 6 and 9 together make this pass; if you run this test after Task 6 but before Task 9, the body assertions pass and only the `status` assertion fails, which is the precise gap Task 9 closes.

- [ ] **Step 3: Write minimal implementation**

In `packages/server/src/render.tsx`, add the import (beside the other `@hono-preact/iso/internal` imports):

```ts
import { takeServerDeny } from '@hono-preact/iso/internal';
```

Apply the recorded deny after `rootResult` is known to be a value and before the streaming/non-streaming split. Insert right after `streamingLoaders = rootResult.streamingLoaders;` (`:192`):

```ts
  // A loader that denied during SSR rendered its errorFallback in-tree (see
  // iso's DataReader / RouteBoundary) and recorded the response facts here.
  // Apply them to the assembled document so the branded page ships at the deny
  // status with the deny's headers, matching client-navigation output.
  const serverDeny = takeServerDeny();
  if (serverDeny) {
    applyOutcomeHeaders(c, serverDeny.headers);
    c.status(serverDeny.status);
  }
```

Confirm `applyOutcomeHeaders` is imported in `render.tsx`; if not, add `import { applyOutcomeHeaders } from './outcome-translation.js';`. `c.status(...)` sets the status Hono uses for the subsequent `c.html(...)` (the non-streaming return at `:261`), so that path needs no further change.

For the streaming return (`:266`), thread the status in. First, in `packages/server/src/stream-pump.ts`, add an optional `status` to `streamDocumentResponse`'s opts (`:82-97`) and use it in the final `c.body(...)` (`:255`):

```ts
    dev?: boolean;
    /**
     * The document HTTP status. Defaults to 200; set to a loader deny's status
     * when a streaming page also rendered an SSR loader deny.
     */
    status?: ContentfulStatusCode;
```

Destructure it (`:99-105`): add `status = 200,` to the destructured defaults. Import the type at the top of `stream-pump.ts`:

```ts
import type { ContentfulStatusCode } from 'hono/utils/http-status';
```

Change the return (`:255`):

```ts
  return c.body(responseStream, status, {
```

Then in `render.tsx`'s streaming return (`:266-272`), pass the status:

```ts
  return streamDocumentResponse(c, {
    fullHtml,
    streamingLoaders,
    requestSignal: c.req.raw.signal,
    bindRequestScope,
    dev: options?.dev ?? false,
    status: serverDeny ? serverDeny.status : undefined,
  });
```

(`ServerDenyRecord.status` is `ErrorStatusCode`, a subset of `ContentfulStatusCode`, so it is assignable without a cast.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/server/src/__tests__/render-loader-deny.test.tsx`
Expected: PASS.

- [ ] **Step 5: Build iso, then regression the server suite**

The server test imports `takeServerDeny` from the built `@hono-preact/iso/internal`, so rebuild iso first:

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Then: `pnpm exec vitest run packages/server/src/__tests__`
Expected: PASS, including `render-honocontext.test.tsx` (middleware deny still bare text 403 — its `<Page>` has no `errorFallback`, so `RouteBoundary` rethrows the untagged deny).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/render.tsx packages/server/src/stream-pump.ts packages/server/src/__tests__/render-loader-deny.test.tsx
git commit -m "feat(server): apply SSR loader deny status + headers to the rendered document (#287)"
```

---

### Task 10: End-to-end integration + parity guards

**Files:**
- Modify: `packages/server/src/__tests__/render-loader-deny.test.tsx` (extend with the boundary cases)
- Test: same file

**Interfaces:**
- Consumes: everything above. No new production code — this task locks the behavior matrix from the spec.

- [ ] **Step 1: Write the failing tests (added cases)**

Append to `packages/server/src/__tests__/render-loader-deny.test.tsx`:

```tsx
import { Page } from '@hono-preact/iso';

// A loader with NO local errorFallback, under a Page that HAS one.
const bareLoader = defineLoader(async () => {
  throw (await import('@hono-preact/iso')).deny(404, 'nope');
});

describe('SSR loader deny boundary matrix', () => {
  it('page-level errorFallback catches a loader deny with no local fallback', async () => {
    const Layout = () => (
      <html>
        <body>
          <Page errorFallback={(e: Error) => <div class="page-fb">{e.message}</div>}>
            <bareLoader.View>{() => <div>never</div>}</bareLoader.View>
          </Page>
        </body>
      </html>
    );
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('class="page-fb"');
    // No local Envelope bake for this sub-case (page-level catch):
    expect(body).not.toContain('data-loader-deny');
  });

  it('a loader deny with NO fallback anywhere is still bare text at the status', async () => {
    const Layout = () => (
      <html>
        <body>
          <bareLoader.View>{() => <div>never</div>}</bareLoader.View>
        </body>
      </html>
    );
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('<!doctype html>');
    expect(body.trim()).toBe('nope');
  });

  it('a loader redirect during SSR is a real 302 (not a rendered fallback)', async () => {
    const redirecting = defineLoader(async () => {
      throw (await import('@hono-preact/iso')).redirect('/login');
    });
    const Layout = () => (
      <html>
        <body>
          <redirecting.View errorFallback={<div class="fb">err</div>}>
            {() => <div>never</div>}
          </redirecting.View>
        </body>
      </html>
    );
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('deny headers ride the document response', async () => {
    const withHeader = defineLoader(async () => {
      const iso = await import('@hono-preact/iso');
      throw iso.deny(403, 'no', { headers: { 'x-deny': 'yes' } });
    });
    const Layout = () => (
      <html>
        <body>
          <withHeader.View errorFallback={(e: Error) => <div class="fb">{e.message}</div>}>
            {() => <div>never</div>}
          </withHeader.View>
        </body>
      </html>
    );
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(403);
    expect(res.headers.get('x-deny')).toBe('yes');
  });
});
```

Confirm the `deny(status, message, { headers })` overload signature against `packages/iso/src/outcomes.ts:108-163` and adjust the `withHeader` call if the options shape differs. Confirm `Page` and `redirect` are exported from `@hono-preact/iso`.

- [ ] **Step 2: Run tests to verify pass/fail state**

Run: `pnpm exec vitest run packages/server/src/__tests__/render-loader-deny.test.tsx`
Expected: All PASS if Tasks 1-9 are complete (this task is pure behavior-locking; no new production code). If the page-level case (`page-fb`) fails, verify the loader deny is being tagged by `DataReader` (Task 6) and `RouteBoundary` reads the tag (Task 5). If the redirect case renders a fallback instead of 302, verify `getDerivedStateFromError`/`DataReader` only special-case `isLoaderDeny`/`isDeny` for DENY, never redirect.

- [ ] **Step 3: (No new implementation — fix regressions only)**

If any case fails, the fix belongs in the task that owns that behavior (5, 6, or 9), not here. Make the minimal fix there, re-run its task test, then re-run this file.

- [ ] **Step 4: Full framework + server suite green**

Run (from repo root, mirroring the relevant CI steps):

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm exec vitest run packages/iso packages/server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/__tests__/render-loader-deny.test.tsx
git commit -m "test(server): lock SSR loader deny boundary matrix + parity guards (#287)"
```

---

## Final verification (run before opening the PR)

Mirror CI in order (per repo `CLAUDE.md` pre-push section). From the repo root:

- [ ] `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
- [ ] `pnpm gen:agents-corpus`
- [ ] `pnpm format:check` (if it fails, `pnpm format` then commit)
- [ ] `pnpm typecheck`
- [ ] `pnpm test:types`
- [ ] `pnpm test:coverage` (or `pnpm test`)
- [ ] `pnpm test:integration`
- [ ] `pnpm --filter site build`

## Docs sync

- [ ] Check whether the loaders / error-handling docs page in `apps/site` documents SSR deny behavior. If it states or implies that an SSR loader deny yields bare text, update it to describe the current behavior (renders the route's `errorFallback` at the deny status; no local fallback falls through to a page-level `errorFallback`, then to bare text). Follow the repo rule: describe what IS, with no "previously / replaces" migration breadcrumbs. Grep first: `rg -n "deny|errorFallback" apps/site/src` and read the relevant page before editing.

## Manual demo check (optional but recommended)

- [ ] The issue's live repro: `GET /demo/projects/nope` (signed in). After this change it should return a full branded document at 404 with the board View's error panel, and hydrate without a refetch of that loader. Confirm the demo board View actually declares an `errorFallback` (it does per the issue); if a route-bound demo loader needs a `location`, that is already wired by the demo route.

---

## Self-Review (author-completed)

**Spec coverage:**
- §1 registry → Task 1. §2 boundary → Task 5. §2a tag → Task 2. §3 DataReader intercept + bake → Task 6. §4 anchor → Task 3. §5 client seed → Tasks 4 (read) + 7 (seed). §6 client re-wrap → Task 8. §7 renderPage status → Task 9. §8 exports → folded into Tasks 1 & 4. Tests → Tasks 1-10. Docs sync → final section. All spec sections mapped.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows full code; the two intrinsically API-shaped spots (loader test-helper construction, `LoaderRef` fields) carry an explicit "confirm against file X and adjust" instruction with the exact file and the invariant the test must assert, not a hand-wave.

**Type consistency:** `ServerDenyRecord { status: ErrorStatusCode; headers }` used identically in Tasks 1, 5, 6, 9. `markLoaderDeny`/`isLoaderDeny`/`LOADER_DENY` consistent Tasks 2, 5, 6. `HydrationAnchor` deny kind `{kind:'deny';message}` identical Tasks 3, 6, 8. `getPreloadedDeny` → `{present;message}` Tasks 4, 7. `LoaderView` coldError `fromBakedDeny?: true` Tasks 7, 8. `streamDocumentResponse` `status?: ContentfulStatusCode` Task 9 both sides. No name drift.
