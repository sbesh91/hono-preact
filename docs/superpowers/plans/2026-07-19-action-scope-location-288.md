# Action-scope location for route middleware (#288) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give route-bound actions a route-authoritative `location` on the guard ctx so a route-node `use` guard can gate action scope, closing the demo's archived-project read-only bypass end to end.

**Architecture:** Add an optional `location?: RouteHook` to `ServerActionCtx`. In `page-actions-handler`, for a route-bound action (`entry.routeId` set), derive `pathParams` by matching the POST URL against the action's own declared pattern using preact-iso's `exec` matcher (shared, one implementation), then populate `ctx.location`. Bare actions and the in-process `call()` path get no location. A route-bound action whose URL does not match its pattern fails closed (403). The demo's four bare board actions convert to `route.action`; the archived gate then denies action scope.

**Tech Stack:** TypeScript, Preact, Hono, preact-iso, valibot, Vitest. pnpm workspace monorepo (`packages/iso`, `packages/server`, `apps/site`).

## Global Constraints

- No em-dashes in prose, code comments, or commit messages. Use commas, colons, parentheses, or two sentences.
- Public-API change must stay additive and non-breaking: `location` is OPTIONAL on `ServerActionCtx`. Do not make it required.
- Never source action `pathParams` from the request body. Derive server-side from the matched route. Do not reuse `validateLocation`.
- One param-capture implementation only. Do not add a second matcher; share `matchRouteParams`.
- All file paths are inside the worktree `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/288-action-scope-location`. Use worktree-prefixed absolute paths for Read/Edit/Write; run all commands from the worktree root.
- Do NOT use Serena tools in this worktree (it indexes the main checkout). Use rg/Read/Edit.
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit.
- Every commit message ends with this trailer (append after a blank line):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Do NOT push, open a PR, or create a GitHub issue without explicit user go-ahead (Task 6 stops for it).

---

### Task 1: Shared route-param matcher (`matchRouteParams`)

Extract preact-iso `exec`-based param capture into one shared module the server can import, and route the existing client `matchPath` through it so there is a single implementation.

**Files:**
- Create: `packages/iso/src/internal/match-route.ts`
- Create: `packages/iso/src/internal/__tests__/match-route.test.ts`
- Modify: `packages/iso/src/route-active.ts:1-41` (delegate `matchPath`, drop local `execParams` + `exec` import)
- Modify: `packages/iso/src/internal-runtime.ts:81-90` (export `matchRouteParams` from the runtime barrel)

**Interfaces:**
- Produces: `matchRouteParams(path: string, route: string, exact: boolean): Record<string, string> | null` — captured params on a match, else null; non-exact adds a `/*` descendant fallback. Exported from `@hono-preact/iso/internal/runtime`.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/match-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchRouteParams } from '../match-route.js';

describe('matchRouteParams', () => {
  it('captures params on an exact match', () => {
    expect(matchRouteParams('/projects/p1', '/projects/:projectId', true)).toEqual(
      { projectId: 'p1' }
    );
  });

  it('returns null when a descendant path does not match in exact mode', () => {
    expect(
      matchRouteParams('/projects/p1/tasks/t1', '/projects/:projectId', true)
    ).toBeNull();
  });

  it('captures the shallow params for a descendant path in non-exact mode', () => {
    expect(
      matchRouteParams('/projects/p1/tasks/t1', '/projects/:projectId', false)
    ).toMatchObject({ projectId: 'p1' });
  });

  it('returns null for an unrelated path even in non-exact mode', () => {
    expect(matchRouteParams('/other/x', '/projects/:projectId', false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test -- match-route`
Expected: FAIL with "Cannot find module '../match-route.js'".

- [ ] **Step 3: Create the shared matcher**

Create `packages/iso/src/internal/match-route.ts`:

```ts
import { exec } from 'preact-iso';

/**
 * Capture a concrete URL's route params against a pattern using preact-iso's
 * own `exec` matcher, so server-side param extraction agrees exactly with the
 * client router. Returns the captured params on a match, else null. In
 * non-exact mode a descendant path also matches (a `/*` fallback), so a unit
 * bound to `/a/:x` still yields `{ x }` when addressed from `/a/p/b/q`.
 *
 * preact-iso types `exec` as always returning a match whose params are `any`,
 * but at runtime it returns `undefined` on no match; the optional chain pins
 * the half we use to `Record<string, string>`.
 */
export function matchRouteParams(
  path: string,
  route: string,
  exact: boolean
): Record<string, string> | null {
  const direct = exec(path, route)?.pathParams;
  if (direct) return direct;
  if (!exact) {
    const nested = exec(path, route.replace(/\/+$/, '') + '/*')?.pathParams;
    if (nested) return nested;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/iso test -- match-route`
Expected: PASS (4 tests).

- [ ] **Step 5: Route the client `matchPath` through the shared matcher (DRY)**

Edit `packages/iso/src/route-active.ts`. Replace the top of the file (lines 1-41: the `exec` import, the private `execParams`, and the body of `matchPath`) so `matchPath` delegates to `matchRouteParams` and the local `execParams` + `exec` import are removed. The new lines 1-41 region:

```ts
import { useLocation } from 'preact-iso';
import { matchRouteParams } from './internal/match-route.js';
import type { RouteParams, RoutePattern } from './internal/typed-routes.js';

export interface RouteMatchOptions {
  /** When false, also match descendant paths (segment-prefix). Default true. */
  exact?: boolean;
}

/**
 * Test `path` against a route pattern (same grammar as `<Route path>`).
 * Returns the captured params on a match, else null. In non-exact mode a
 * descendant path also matches (`/a` matches `/a/b`). Delegates to the shared
 * `matchRouteParams` so client and server capture params identically.
 */
export function matchPath(
  path: string,
  route: string,
  exact: boolean
): Record<string, string> | null {
  return matchRouteParams(path, route, exact);
}
```

Leave `useRouteMatch` and `useRouteActive` (below line 41) unchanged; they already call `matchPath`.

- [ ] **Step 6: Export `matchRouteParams` from the runtime barrel**

Edit `packages/iso/src/internal-runtime.ts`. After the `param-slots.js` export block (ends line 90), add:

```ts
// Route-param capture (preact-iso `exec`) shared with @hono-preact/server's
// page-actions handler, so a route-bound action's guard sees exactly the
// params the client router computes for the same URL.
export { matchRouteParams } from './internal/match-route.js';
```

- [ ] **Step 7: Verify the whole iso package (existing matchPath tests still green)**

Run: `pnpm --filter @hono-preact/iso test && pnpm --filter @hono-preact/iso typecheck`
Expected: PASS, including `route-active.test.tsx` (matchPath behavior unchanged) and `use-prefetch` consumers.

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/internal/match-route.ts packages/iso/src/internal/__tests__/match-route.test.ts packages/iso/src/route-active.ts packages/iso/src/internal-runtime.ts
git commit
```
Message (with the Global-Constraints trailer):
```
feat(iso): share a route-param matcher for server-side capture (#288)
```

---

### Task 2: Optional `location` on `ServerActionCtx`

Add the public type field and its type-level assertion. Additive and non-breaking.

**Files:**
- Modify: `packages/iso/src/define-middleware.ts:24-29` (add `location?`)
- Modify: `packages/server/src/__tests__/compose-server-chain.test-d.ts:19-26` (positive assertion)

**Interfaces:**
- Produces: `ServerActionCtx['location']` is `RouteHook | undefined`.
- Consumes: `RouteHook` (already imported in `define-middleware.ts:2`).

- [ ] **Step 1: Write the failing type assertion**

Edit `packages/server/src/__tests__/compose-server-chain.test-d.ts`. Inside `_ctxNarrowingProbe`, after line 25 (the `not.toEqualTypeOf<ServerActionCtx>` line), add:

```ts
  // Action ctx carries an OPTIONAL route-authoritative location (#288): present
  // for route-bound actions, absent for bare actions and the call() path.
  expectTypeOf<ServerActionCtx['location']>().toEqualTypeOf<
    ServerLoaderCtx['location'] | undefined
  >();
```

- [ ] **Step 2: Run the type test to verify it fails**

Run: `pnpm test:types`
Expected: FAIL — `ServerActionCtx['location']` is currently `never`/missing, not `RouteHook | undefined`.

- [ ] **Step 3: Add the field**

Edit `packages/iso/src/define-middleware.ts`. Replace the `ServerActionCtx` type (lines 24-29) with:

```ts
export type ServerActionCtx = ServerBaseCtx & {
  scope: 'action';
  module: string;
  action: string;
  payload: unknown;
  /**
   * Route-authoritative location for route-bound actions
   * (`serverRoute(r).action`): the invoking page URL matched against the
   * action's own declared pattern, so a route-node guard can gate action scope
   * by `ctx.location.pathParams` exactly as it does page and loader scope.
   * Absent for a bare `defineAction` (route-independent, runs no route-node page
   * tier) and for the in-process `call()` path (runs no route-node middleware).
   */
  location?: RouteHook;
};
```

- [ ] **Step 4: Run the type test to verify it passes**

Run: `pnpm test:types`
Expected: PASS.

- [ ] **Step 5: Verify both ctx construction sites still compile**

`packages/iso/src/server-caller.ts:201-208` builds a `ServerActionCtx` without `location`; the optional field means it needs no change. Confirm the whole build typechecks.

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: PASS (no error at `server-caller.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-middleware.ts packages/server/src/__tests__/compose-server-chain.test-d.ts
git commit
```
Message:
```
feat(iso): add optional route-authoritative location to ServerActionCtx (#288)
```
(Additive and non-breaking: `location` is optional, so no existing consumer or construction site breaks. Keep the body one line stating that.)

---

### Task 3: Populate the action location (and deny on mismatch)

Derive and attach the location in the action handler, deny a route-bound action whose URL does not match its pattern, and prove a route-node guard can now gate action scope.

**Files:**
- Modify: `packages/server/src/page-actions-handler.ts:23` (import), `:262` (capture URL), `:336-344` (derive + attach)
- Modify: `packages/server/src/__tests__/page-actions-handler.test.ts` (new tests)

**Interfaces:**
- Consumes: `matchRouteParams` from `@hono-preact/iso/internal/runtime` (Task 1); `ServerActionCtx['location']` (Task 2).

- [ ] **Step 1: Write the failing tests**

Edit `packages/server/src/__tests__/page-actions-handler.test.ts`. Add these tests inside the `describe('pageActionsHandler', …)` block (they reuse `buildHandler`, `Hono`, `deny`, `defineServerMiddleware`, all already imported):

```ts
  // A guard that reports the action-scope location it received, so a test can
  // assert exactly what the framework populated (denies 400 with the location
  // serialized as JSON).
  const locationReporter = () =>
    defineServerMiddleware<'action'>(async (ctx) => {
      throw deny(400, JSON.stringify(ctx.location ?? null));
    });

  const postAction = (
    handler: ReturnType<typeof buildHandler>,
    url: string,
    action = 'submit'
  ) =>
    new Hono().post('*', handler).request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module: 'pages/test.server', action, payload: {} }),
    });

  it('populates a route-authoritative location for a route-bound action', async () => {
    const handler = buildHandler(
      { submit: { fn: async () => ({ ok: true }), routeId: '/projects/:projectId' } },
      { byPattern: async () => [locationReporter()] }
    );
    const res = await postAction(handler, '/projects/p1');
    expect(res.status).toBe(400);
    const loc = JSON.parse((await res.json()).message);
    expect(loc.path).toBe('/projects/p1');
    expect(loc.pathParams).toEqual({ projectId: 'p1' });
  });

  it('gives a bare action no location', async () => {
    const handler = buildHandler({
      submit: { fn: async () => ({ ok: true }), use: [locationReporter()] },
    });
    const res = await postAction(handler, '/projects/p1');
    expect(res.status).toBe(400);
    expect(JSON.parse((await res.json()).message)).toBeNull();
  });

  it('denies a route-bound action whose URL does not match its pattern (403)', async () => {
    const handler = buildHandler(
      { submit: { fn: async () => ({ ok: true }), routeId: '/projects/:projectId' } },
      { byPattern: async () => [] }
    );
    const res = await postAction(handler, '/totally/unrelated');
    expect(res.status).toBe(403);
  });

  it('lets a route-node guard gate a route-bound action by its route params', async () => {
    const archivedGuard = defineServerMiddleware<'action'>(async (ctx, next) => {
      if (ctx.location?.pathParams.projectId === 'legacy') throw deny(403, 'archived');
      await next();
    });
    const handler = buildHandler(
      { mutate: { fn: async () => ({ ok: true }), routeId: '/projects/:projectId' } },
      { byPattern: async () => [archivedGuard] }
    );
    expect((await postAction(handler, '/projects/legacy', 'mutate')).status).toBe(403);
    expect((await postAction(handler, '/projects/active', 'mutate')).status).toBe(200);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hono-preact/server test -- page-actions-handler`
Expected: FAIL — the first test sees `ctx.location` undefined (reporter serializes `null`); the mismatch test returns 200 not 403.

- [ ] **Step 3: Import the matcher**

Edit `packages/server/src/page-actions-handler.ts`. In the import block from `@hono-preact/iso/internal/runtime` (currently `FORM_MODULE_FIELD, FORM_ACTION_FIELD, coerceActionInput, collectFormData`), add `matchRouteParams`:

```ts
import {
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
  coerceActionInput,
  collectFormData,
  matchRouteParams,
} from '@hono-preact/iso/internal/runtime';
```

- [ ] **Step 4: Capture the URL once**

Edit `packages/server/src/page-actions-handler.ts:262`. Replace:

```ts
    const urlPath = new URL(c.req.url).pathname;
```

with:

```ts
    const url = new URL(c.req.url);
    const urlPath = url.pathname;
```

- [ ] **Step 5: Derive and attach the location**

Edit `packages/server/src/page-actions-handler.ts`. Replace the ctx construction (currently lines 337-344, the `const ctx: ServerActionCtx = { … }` literal) so it is preceded by the derivation and includes `location`:

```ts
    // Route-authoritative location for route-bound actions (#288): match the
    // invoking page URL against the action's own declared pattern to recover
    // pathParams, so a route-node guard can gate action scope by
    // `ctx.location.pathParams`. Non-exact so an action bound to a shallower
    // pattern still resolves params when POSTed from a descendant page URL.
    // Bare actions get no location (they run no route-node page tier). A
    // route-bound action whose URL does not match its pattern fails closed
    // (defensive: byPath resolution normally guarantees a match).
    let location: ServerActionCtx['location'];
    if (typeof routeId === 'string') {
      const pathParams = matchRouteParams(urlPath, routeId, false);
      if (pathParams === null) {
        const msg = `Action '${action}' cannot run from '${urlPath}' (bound to '${routeId}')`;
        return accept === 'json'
          ? c.json({ __outcome: 'error', message: msg }, 403)
          : c.text(msg, 403);
      }
      location = {
        path: urlPath,
        pathParams,
        searchParams: Object.fromEntries(url.searchParams),
      };
    }
    const ctx: ServerActionCtx = {
      scope: 'action',
      c,
      signal,
      module,
      action,
      payload,
      location,
    };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @hono-preact/server test -- page-actions-handler`
Expected: PASS (all four new tests plus the existing suite).

- [ ] **Step 7: Typecheck the server package**

Run: `pnpm --filter @hono-preact/server typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/page-actions-handler.ts packages/server/src/__tests__/page-actions-handler.test.ts
git commit
```
Message:
```
feat(server): populate route-authoritative location on route-bound action ctx (#288)
```

---

### Task 4: Demo adoption and gate coverage

Convert the four bare board actions to route-bound, gate action scope in the archived gate, and flip the demo test.

**Files:**
- Modify: `apps/site/src/pages/demo/project-board.server.ts:2` (import), `:142-205` (`defineAction` -> `route.action` x4)
- Modify: `apps/site/src/demo/archived-gate.ts` (helper + middleware + comments)
- Modify: `apps/site/src/demo/__tests__/archived-gate.test.ts:6-8,41-43` (flip + comment)

**Interfaces:**
- Consumes: the runtime `location` from Task 3 (task-detail actions in `task.server.ts` are already `route.action`, so they gain gating with no source change).

- [ ] **Step 1: Write the failing test (flip the demo assertion)**

Edit `apps/site/src/demo/__tests__/archived-gate.test.ts`. Replace the action test (lines 41-43):

```ts
  it('passes actions through regardless of project state', () => {
    expect(archivedOutcomeFor('action', 'legacy')).toBeUndefined();
  });
```

with:

```ts
  it('denies an action on an archived project (403)', () => {
    const outcome = archivedOutcomeFor('action', 'legacy');
    expect(outcome && isDeny(outcome)).toBe(true);
    if (outcome && isDeny(outcome)) expect(outcome.status).toBe(403);
  });

  it('passes an action on a live project through', () => {
    expect(archivedOutcomeFor('action', 'inf')).toBeUndefined();
  });
```

Also update the file-top comment (lines 6-8) to describe the new behavior:

```ts
// The gate branches on scope: page scope swaps the tree via render() (a
// page-scope-only outcome), while loader scope denies 410 and action scope
// denies 403. Route-bound actions now carry a route-authoritative location
// (#288), so the same per-resource rule covers them.
```

- [ ] **Step 2: Run the demo test to verify it fails**

Run: `pnpm --filter site test -- archived-gate`
Expected: FAIL — `archivedOutcomeFor('action', 'legacy')` currently returns `undefined`.

- [ ] **Step 3: Gate action scope in the archived gate**

Edit `apps/site/src/demo/archived-gate.ts`. Replace `archivedOutcomeFor` and `archivedGateServer` (and the file-top comment) with:

```ts
// render() is a page-scope-only outcome (it swaps the page tree), so loader and
// action scope deny instead: a client-side nav to an archived project surfaces
// the message through the board View's errorFallback, a full reload gets the
// swapped notice page, and a mutation is refused. A route-node guard now covers
// action scope because a route-bound action carries a route-authoritative
// location (#288); the task-detail actions are already route-bound and the board
// actions are bound below.
export function archivedOutcomeFor(
  scope: 'page' | 'loader' | 'action',
  projectId: string | undefined
): Outcome | undefined {
  const project = projectId ? getProjectBySlug(projectId) : null;
  if (!project?.archived) return undefined;
  if (scope === 'page') return render(ArchivedProjectNotice);
  return deny(
    scope === 'loader' ? 410 : 403,
    'This project is archived and read-only.'
  );
}

// Declared as `use` on the /demo/projects/:projectId route node, so it runs for
// the page render, every loader RPC, and every route-bound action under that
// node. Every scope now carries a location (action optionally, for route-bound
// actions), so the gate reads pathParams uniformly.
export const archivedGateServer = defineServerMiddleware(async (ctx, next) => {
  const outcome = archivedOutcomeFor(
    ctx.scope,
    ctx.location?.pathParams.projectId
  );
  if (outcome) return outcome;
  await next();
});
```

- [ ] **Step 4: Run the demo test to verify it passes**

Run: `pnpm --filter site test -- archived-gate`
Expected: PASS.

- [ ] **Step 5: Convert the four board actions to route-bound**

Edit `apps/site/src/pages/demo/project-board.server.ts`.

First, drop `defineAction` from the import (line 2):

```ts
import { deny, publish, serverRoute } from 'hono-preact';
```

Then, in `export const serverActions` (lines ~142-205), change each of the four `defineAction(` opening calls to `route.action(` (the `route = serverRoute('/demo/projects/:projectId')` binding already exists at line 42; leave every function body and the `{ input: … }` options untouched):

- `createTask: defineAction(` -> `createTask: route.action(`
- `patchTask: defineAction(` -> `patchTask: route.action(`
- `deleteTask: defineAction(` -> `deleteTask: route.action(`
- `restoreTask: defineAction(` -> `restoreTask: route.action(`

- [ ] **Step 6: Verify the demo suite (conversion did not break existing tests)**

Run: `pnpm --filter site test -- project-board.server archived-gate`
Expected: PASS. If `project-board.server.test.ts` asserted a bare-action shape that changed, update that assertion to the route-bound shape (the action fn behavior is unchanged; only `__routeId` is now set).

- [ ] **Step 7: Typecheck the site**

Run: `pnpm --filter site typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/pages/demo/project-board.server.ts apps/site/src/demo/archived-gate.ts apps/site/src/demo/__tests__/archived-gate.test.ts
git commit
```
Message:
```
fix(site): gate archived-project mutations by route-bound action scope (#288)
```

---

### Task 5: Docs sync

Rewrite the shipped caveat and the `serverRoute(r).action` docstring so they describe current behavior (no migration breadcrumbs, per repo convention).

**Files:**
- Modify: `apps/site/src/pages/docs/middleware.mdx` (the action-scope-location caveat, ~line 143)
- Modify: `packages/iso/src/server-route.ts:117-127` (the `.action` docstring)

- [ ] **Step 1: Rewrite the middleware caveat**

Read `apps/site/src/pages/docs/middleware.mdx` around lines 138-150. Replace the sentence that states action scope carries no location (currently: "page and loader scope carry a `location` … while action scope does not (`ServerActionCtx` is `{ c, signal, scope, module, action, payload }`). A guard that reads `ctx.location.pathParams` … therefore applies to renders and loaders only; enforce the same rule for actions inside the action body …") with:

```md
The context's shape follows the scope: page and loader scope carry a `location`
(path and search params), and route-bound action scope does too. A per-resource
gate declared on a route node that reads `ctx.location.pathParams` therefore
applies to renders, loaders, and route-bound actions (`serverRoute(r).action`)
alike. Two cases carry no location: a bare `defineAction` (route-independent, so
bind it with `serverRoute(r)` or give it a unit-level `use` to gate it), and the
in-process `call()` path (server-to-server, which runs no route-node middleware).
```

- [ ] **Step 2: Rewrite the `serverRoute(r).action` docstring**

Read `packages/iso/src/server-route.ts:110-130`. Update the `.action` docstring so it no longer says the ctx has no `location`/param typing. State that a route-bound action's guard ctx carries a route-authoritative `location` (params from the matched route), while the action body ctx still exposes no route params (payload only). Keep it to the same two-to-three sentence shape as the surrounding `.loader` docstring.

- [ ] **Step 3: Sweep for other location-less-action claims**

Run: `rg -n "action scope|no location|location-less|carries no" apps/site/src/pages/docs packages/iso/src` and fix any remaining doc/comment that asserts actions are location-less (describe current behavior only).

- [ ] **Step 4: Verify docs format + build**

Run: `pnpm format:check && pnpm --filter site build`
Expected: PASS. If `format:check` fails, run `pnpm format` and re-stage.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/docs/middleware.mdx packages/iso/src/server-route.ts
git commit
```
Message:
```
docs: action scope carries a route-authoritative location for route-bound actions (#288)
```

---

### Task 6: Full verification, follow-up issue, and PR (stops for your go-ahead)

**Files:** none (verification + external actions).

- [ ] **Step 1: Run the full pre-push CI parity locally (CLAUDE.md, in order)**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all PASS. Fix any failure before proceeding (if `format:check` fails, `pnpm format` then re-commit).

- [ ] **Step 2: STOP and confirm with the user**

Report the green CI-parity run and the diff summary. Ask for go-ahead before any push/PR/issue creation (Global Constraints).

- [ ] **Step 3: File the Option 2 follow-up issue (after go-ahead)**

Create a GitHub issue: "Typed route params on the action body ctx (`ActionCtx`) via `serverRoute(r).action` overloads (follow-up to #288)". Body: #288 gave the guard ctx a route-authoritative `location`; this follow-up would mirror route-bound `LoaderCtx` and expose typed `location`/params on the action body ctx, reversing the current "an action's ctx exposes no route params" stance and threading param types through the `serverRoute(r).action` overloads. Note the `call()` soundness wart (the in-process caller has no route pattern). Label `framework-api`, milestone as the user directs.

- [ ] **Step 4: Push, open the PR, run the deep review (after go-ahead)**

Push the branch, open the PR against `main` (reference #288), then immediately run the deep PR review per `REVIEW.md` (the `PostToolUse` hook reminds after `gh pr create`). PR body ends with the Claude Code generation trailer.

---

## Self-Review

**Spec coverage:**
- Optional `location` on `ServerActionCtx` -> Task 2.
- Server-side derivation (route-bound only, non-exact) -> Task 3 Steps 4-5.
- Extractor = one shared `exec`-based matcher via the runtime barrel -> Task 1.
- Deny on mismatch (Decision 1a) -> Task 3 Step 5 + test in Step 1.
- Bare actions / `call()` get no location -> Task 3 (bare branch) + Task 2 Step 5 (server-caller unchanged).
- `searchParams` from the POST URL; wide grammar, no boot-conformance change -> Task 3 Step 5 (Object.fromEntries(url.searchParams)); Task 1 uses `exec` (wide grammar), no `assertConformingBoundRouteId` change.
- Demo adoption: board actions bare -> route.action; task actions already bound; gate denies action scope -> Task 4.
- Docs: middleware.mdx + server-route.ts docstring + sweep -> Task 5.
- Testing: type-level (Task 2), unit + framework integration (Task 3), demo flip (Task 4).
- Non-goal Option 2 filed as a follow-up -> Task 6 Step 3.
- Trust model (never from body) -> honored: derivation uses `matchRouteParams(urlPath, routeId)`, never the request body.

**Placeholder scan:** none. Docs steps (Task 5) read the current prose then replace with the drafted text; the new text is given in full.

**Type consistency:** `matchRouteParams(path, route, exact)` signature is identical in Task 1 (definition), the barrel export, and Task 3 (call). `ServerActionCtx['location']` (`RouteHook | undefined`) is used consistently in Task 2 (type), Task 3 (`let location: ServerActionCtx['location']`), and Task 4 (`ctx.location?.pathParams.projectId`). `archivedOutcomeFor(scope, projectId)` keeps its `(scope, string | undefined)` signature across Task 4's helper, middleware, and test.
