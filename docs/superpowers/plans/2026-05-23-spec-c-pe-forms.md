# Spec C — PE forms implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/__actions` with per-page POST handlers so `<Form>` submissions work without client JS, while keeping the JS-on path under a single content-negotiated endpoint.

**Architecture:** The Hono app stops mounting a global `/__actions` route. The wildcard renderer (`.all('*', ...)`) handles both GET (render) and POST (action). On POST, a new `pageActionHandler` resolves the target action from the page's chain (page + layouts), runs it, then either responds with a JSON envelope (`Accept: application/json`), a real 30x (PE redirect/success), an SSE stream (streaming actions), or an HTML re-render of the same page (PE deny / error). The action result and the parsed payload are made visible to the page render via async-local-storage, exposed through `useActionResult()` and `useFormStatus()` hooks. `<Form>` becomes a thin shell that posts the stub's `__module` / `__action` as hidden inputs to the current URL; `useOptimisticAction`'s return value is reshaped to be stub-compatible (with a private brand) so `<Form action={optimistic}>` drives optimism with zero wiring.

**Tech Stack:** TypeScript, Preact, Hono, Vitest. Existing internal primitives reused: `runRequestScope`, `dispatchServer`, `partitionUse`, `useOptimistic`, `sseGeneratorResponse` / `sseReadableStreamResponse`.

**Reading map (read once before starting):**

- Spec: `docs/superpowers/specs/2026-05-23-spec-c-pe-forms-design.md`
- Project memory: `feedback_no_schedule_pressure` (no migration shims; hard cutover), `feedback_avoid_type_casts` (reshape signatures, don't `as`-cast), `feedback_docs_no_migration_breadcrumbs` (docs describe what is, not what changed)
- Current shape:
  - `packages/server/src/actions-handler.ts` — soon-to-be-deleted global handler
  - `packages/server/src/route-server-modules.ts` — `makePageUseResolvers` is the model for `makePageActionResolvers`
  - `packages/server/src/render.tsx` — `renderPage` export, integration point for action-result context injection
  - `packages/iso/src/form.tsx`, `action.ts`, `optimistic-action.ts`, `outcomes.ts` — all rewritten or extended
  - `packages/vite/src/server-entry.ts` lines 30–80 — generated entry template
  - `apps/site/src/pages/demo/{login,project-issues,issue,projects}.tsx` — `<Form>` / `useAction` call sites to migrate

---

## Task 1: Extend `deny()` to accept structured `data`

**Files:**
- Modify: `packages/iso/src/outcomes.ts`
- Test: `packages/iso/src/__tests__/outcomes.test.ts` (extend if exists, else create)

- [ ] **Step 1: Find current deny() tests**

Run: `find packages/iso/src/__tests__ -name "outcomes*" -o -name "deny*"`

If none exists, create `packages/iso/src/__tests__/outcomes.test.ts` with imports for `deny` and `DenyOutcome`.

- [ ] **Step 2: Write failing tests for the new shape**

Add to `packages/iso/src/__tests__/outcomes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deny } from '../outcomes.js';

describe('deny() with structured data', () => {
  it('carries opts.data through unchanged on the (status, message, opts) form', () => {
    const fieldErrors = { email: ['required'], name: ['too short'] };
    const outcome = deny(422, 'Validation failed', { data: { fieldErrors } });
    expect(outcome.__outcome).toBe('deny');
    expect(outcome.status).toBe(422);
    expect(outcome.message).toBe('Validation failed');
    expect(outcome.data).toEqual({ fieldErrors });
  });

  it('carries opts.data on the (DenyInput) form too', () => {
    const outcome = deny({ status: 403, message: 'no', data: { reason: 'role' } });
    expect(outcome.data).toEqual({ reason: 'role' });
  });

  it('omits data when not provided (back-compat)', () => {
    const outcome = deny(403, 'nope');
    expect(outcome).not.toHaveProperty('data');
  });

  it('exposes opts.headers on the (status, message, opts) form', () => {
    const outcome = deny(401, 'unauth', { headers: { 'WWW-Authenticate': 'Bearer' } });
    expect(outcome.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm -w --filter @hono-preact/iso test outcomes -- --run`
Expected: FAIL — `deny()` does not accept third argument; `outcome.data` undefined.

- [ ] **Step 4: Update `DenyOutcome` type and `deny()` implementation**

Edit `packages/iso/src/outcomes.ts`:

```ts
export type DenyOutcome = {
  __outcome: 'deny';
  status: ErrorStatusCode;
  message: string;
  headers: Record<string, string> | undefined;
  data?: unknown;
};

type DenyInput = {
  status: ErrorStatusCode;
  message?: string;
  headers?: Record<string, string>;
  data?: unknown;
};

type DenyOpts = {
  headers?: Record<string, string>;
  data?: unknown;
};

export function deny(status: ErrorStatusCode, message?: string, opts?: DenyOpts): DenyOutcome;
export function deny(spec: DenyInput): DenyOutcome;
export function deny(
  a: ErrorStatusCode | DenyInput,
  b?: string,
  c?: DenyOpts
): DenyOutcome {
  if (typeof a === 'object') {
    return {
      __outcome: 'deny',
      status: a.status,
      message: a.message ?? `Request denied (${a.status})`,
      headers: a.headers,
      ...(a.data !== undefined ? { data: a.data } : {}),
    };
  }
  return {
    __outcome: 'deny',
    status: a,
    message: b ?? `Request denied (${a})`,
    headers: c?.headers,
    ...(c?.data !== undefined ? { data: c.data } : {}),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -w --filter @hono-preact/iso test outcomes -- --run`
Expected: PASS.

Also run the whole iso test suite to confirm no regressions:
Run: `pnpm -w --filter @hono-preact/iso test -- --run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/outcomes.ts packages/iso/src/__tests__/outcomes.test.ts
git commit -m "feat(iso): deny() accepts optional opts.data for structured payloads"
```

---

## Task 2: Define the uniform JSON envelope helper

The new envelope (`{__outcome: 'success' | 'redirect' | 'deny' | 'error' | 'timeout', ...}`) is used by both the page-action handler and the client. Put the serializer in one place so both sides stay in lockstep.

**Files:**
- Create: `packages/iso/src/internal/action-envelope.ts`
- Test: `packages/iso/src/__tests__/action-envelope.test.ts`
- Modify: `packages/iso/src/internal.ts` (re-export)

- [ ] **Step 1: Write failing tests for the envelope serializer**

Create `packages/iso/src/__tests__/action-envelope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  serializeActionOutcome,
  type ActionEnvelope,
} from '../internal/action-envelope.js';
import { deny, redirect, timeoutOutcome } from '../outcomes.js';

describe('serializeActionOutcome', () => {
  it('wraps a raw return value in __outcome=success', () => {
    const env = serializeActionOutcome({ kind: 'success', data: { id: 1 } });
    expect(env).toEqual({
      body: { __outcome: 'success', data: { id: 1 } },
      status: 200,
      headers: undefined,
    });
  });

  it('emits __outcome=redirect with HTTP 200 (client follows)', () => {
    const env = serializeActionOutcome({ kind: 'outcome', outcome: redirect('/next') });
    expect(env.body).toEqual({ __outcome: 'redirect', to: '/next', status: 302 });
    expect(env.status).toBe(200);
  });

  it('emits __outcome=deny with the deny status and data', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: deny(422, 'bad', { data: { fieldErrors: { x: ['nope'] } } }),
    });
    expect(env.body).toEqual({
      __outcome: 'deny',
      status: 422,
      message: 'bad',
      data: { fieldErrors: { x: ['nope'] } },
    });
    expect(env.status).toBe(422);
  });

  it('emits __outcome=deny without data field when none provided', () => {
    const env = serializeActionOutcome({ kind: 'outcome', outcome: deny(403, 'no') });
    expect(env.body).toEqual({ __outcome: 'deny', status: 403, message: 'no' });
    expect(env.status).toBe(403);
  });

  it('emits __outcome=timeout with HTTP 504', () => {
    const env = serializeActionOutcome({ kind: 'outcome', outcome: timeoutOutcome(30000) });
    expect(env.body).toEqual({ __outcome: 'timeout', timeoutMs: 30000 });
    expect(env.status).toBe(504);
  });

  it('emits __outcome=error with HTTP 500 and a sanitized message in prod', () => {
    const env = serializeActionOutcome({
      kind: 'error',
      message: 'Action failed',
    });
    expect(env.body).toEqual({ __outcome: 'error', message: 'Action failed' });
    expect(env.status).toBe(500);
  });

  it('carries deny headers through to the envelope return value', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: deny(401, 'unauth', { headers: { 'WWW-Authenticate': 'Bearer' } }),
    });
    expect(env.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -w --filter @hono-preact/iso test action-envelope -- --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the envelope serializer**

Create `packages/iso/src/internal/action-envelope.ts`:

```ts
import type {
  Outcome,
  RedirectOutcome,
  DenyOutcome,
  TimeoutOutcome,
} from '../outcomes.js';

export type ActionEnvelope =
  | { __outcome: 'success'; data: unknown }
  | { __outcome: 'redirect'; to: string; status: number }
  | { __outcome: 'deny'; status: number; message: string; data?: unknown }
  | { __outcome: 'error'; message: string }
  | { __outcome: 'timeout'; timeoutMs: number };

export type ActionResolution =
  | { kind: 'success'; data: unknown }
  | { kind: 'outcome'; outcome: Outcome }
  | { kind: 'error'; message: string };

export type SerializedEnvelope = {
  body: ActionEnvelope;
  status: number;
  headers: Record<string, string> | undefined;
};

export function serializeActionOutcome(
  resolution: ActionResolution
): SerializedEnvelope {
  if (resolution.kind === 'success') {
    return {
      body: { __outcome: 'success', data: resolution.data },
      status: 200,
      headers: undefined,
    };
  }
  if (resolution.kind === 'error') {
    return {
      body: { __outcome: 'error', message: resolution.message },
      status: 500,
      headers: undefined,
    };
  }
  const { outcome } = resolution;
  if (outcome.__outcome === 'redirect') {
    return {
      body: { __outcome: 'redirect', to: outcome.to, status: outcome.status },
      status: 200,
      headers: outcome.headers,
    };
  }
  if (outcome.__outcome === 'deny') {
    const body: ActionEnvelope = {
      __outcome: 'deny',
      status: outcome.status,
      message: outcome.message,
    };
    if (outcome.data !== undefined) body.data = outcome.data;
    return { body, status: outcome.status, headers: outcome.headers };
  }
  if (outcome.__outcome === 'timeout') {
    return {
      body: { __outcome: 'timeout', timeoutMs: outcome.timeoutMs },
      status: 504,
      headers: undefined,
    };
  }
  // 'render' outcome is page-scope only; should never reach an action.
  return {
    body: { __outcome: 'error', message: 'render outcome is page-scope only' },
    status: 500,
    headers: undefined,
  };
}
```

- [ ] **Step 4: Re-export from internal barrel**

Edit `packages/iso/src/internal.ts`, add:

```ts
export {
  serializeActionOutcome,
  type ActionEnvelope,
  type ActionResolution,
  type SerializedEnvelope,
} from './internal/action-envelope.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -w --filter @hono-preact/iso test action-envelope -- --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/action-envelope.ts packages/iso/src/__tests__/action-envelope.test.ts packages/iso/src/internal.ts
git commit -m "feat(iso): add uniform action envelope serializer"
```

---

## Task 3: Add the action-result async scope slot

Extend `runRequestScope` so the page-action handler can stash the action's resolution (and submitted payload) for the subsequent render to read. New `getActionResultSlot()` returns the current resolution or null. Server-side only.

**Files:**
- Modify: `packages/iso/src/internal/request-scope.ts` (find via grep first; current home of `runRequestScope`)
- Test: `packages/iso/src/__tests__/request-scope-action-result.test.ts`

- [ ] **Step 1: Locate the current `runRequestScope` definition**

Run: `grep -rn "export function runRequestScope\|export const runRequestScope" packages/iso/src --include="*.ts"`
Expected: a single result, likely in `packages/iso/src/internal/request-scope.ts`.

Read the file (Read tool) to understand the existing slot pattern (`honoContext`). The new `actionResult` slot follows the same pattern.

- [ ] **Step 2: Write the failing test**

Create `packages/iso/src/__tests__/request-scope-action-result.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  runRequestScope,
  getActionResultSlot,
  setActionResultSlot,
  type ActionResultSlot,
} from '../internal/request-scope.js';

describe('action-result slot in request scope', () => {
  it('returns null outside any scope', () => {
    expect(getActionResultSlot()).toBeNull();
  });

  it('returns the value set via setActionResultSlot inside the scope', async () => {
    const slot: ActionResultSlot = {
      module: 'pages/foo.server',
      action: 'submit',
      resolution: { kind: 'success', data: { id: 1 } },
      submittedPayload: { name: 'alice' },
    };
    const seen = await runRequestScope(async () => {
      setActionResultSlot(slot);
      return getActionResultSlot();
    });
    expect(seen).toEqual(slot);
  });

  it('does not leak across scopes', async () => {
    await runRequestScope(async () => {
      setActionResultSlot({
        module: 'a',
        action: 'b',
        resolution: { kind: 'success', data: 1 },
        submittedPayload: null,
      });
    });
    expect(getActionResultSlot()).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm -w --filter @hono-preact/iso test request-scope-action-result -- --run`
Expected: FAIL — `getActionResultSlot` / `setActionResultSlot` not exported.

- [ ] **Step 4: Add the slot to request-scope.ts**

Edit `packages/iso/src/internal/request-scope.ts`. Add alongside the existing slot machinery:

```ts
import type { ActionResolution } from './action-envelope.js';

export type ActionResultSlot = {
  module: string;
  action: string;
  resolution: ActionResolution;
  submittedPayload: unknown;
};

// Existing scope type (likely `RequestScope`) gets an `actionResult` field.
// Match the existing pattern; do NOT define a new AsyncLocalStorage instance.

export function getActionResultSlot(): ActionResultSlot | null {
  const scope = currentScope();   // existing helper; rename per current code
  return scope?.actionResult ?? null;
}

export function setActionResultSlot(slot: ActionResultSlot): void {
  const scope = currentScope();
  if (!scope) {
    throw new Error(
      'setActionResultSlot must be called inside runRequestScope'
    );
  }
  scope.actionResult = slot;
}
```

If the existing scope object is constructed at `runRequestScope` entry (rather than mutated), instead thread `actionResult` through as a mutable field on the scope object the existing code keeps in an `AsyncLocalStorage`. Match local style. Keep the rest of the file unchanged.

- [ ] **Step 5: Re-export from internal barrel**

Edit `packages/iso/src/internal.ts`, add:

```ts
export {
  getActionResultSlot,
  setActionResultSlot,
  type ActionResultSlot,
} from './internal/request-scope.js';
```

(`runRequestScope` is presumably already re-exported; if not, add it too — Task 5's handler imports it from this barrel.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm -w --filter @hono-preact/iso test request-scope-action-result -- --run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/request-scope.ts packages/iso/src/__tests__/request-scope-action-result.test.ts packages/iso/src/internal.ts
git commit -m "feat(iso): action-result slot in request scope"
```

---

## Task 4: `makePageActionResolvers` — flatten action registries across page+layout chain

Analogous to `makePageUseResolvers`. The resolver returns `{ byPath, byModuleKey }`; both produce a flat `Map<string, ActionEntry>` keyed by action name (with the module key recorded on the entry). At a given page URL, every action declared on the page's own `.server.*` AND every ancestor layout's `.server.*` is callable.

**Files:**
- Create: `packages/server/src/page-action-resolvers.ts`
- Test: `packages/server/src/__tests__/page-action-resolvers.test.ts`
- Modify: `packages/server/src/index.ts` (export the new factory)

- [ ] **Step 1: Write failing test**

Create `packages/server/src/__tests__/page-action-resolvers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makePageActionResolvers } from '../page-action-resolvers.js';
import type { ServerRoute } from '@hono-preact/iso';

const layoutAction = async () => 'layout-result';
const pageAction = async () => 'page-result';

const layoutThunk = async () => ({
  __moduleKey: 'pages/_layout.server',
  serverActions: { logout: layoutAction },
});
const pageThunk = async () => ({
  __moduleKey: 'pages/foo.server',
  serverActions: { submit: pageAction },
});

const routes: ServerRoute[] = [
  {
    path: '/foo',
    server: pageThunk,
    ancestors: [layoutThunk],
  } as unknown as ServerRoute,
];

describe('makePageActionResolvers', () => {
  it('byPath includes both page and ancestor actions', async () => {
    const { byPath } = makePageActionResolvers(routes, { dev: false });
    const map = await byPath('/foo');
    expect([...map.keys()].sort()).toEqual(['logout', 'submit']);
    expect(map.get('submit')?.moduleKey).toBe('pages/foo.server');
    expect(map.get('logout')?.moduleKey).toBe('pages/_layout.server');
  });

  it('byModuleKey returns the per-action entry for that module', async () => {
    const { byModuleKey } = makePageActionResolvers(routes, { dev: false });
    const entry = await byModuleKey('pages/foo.server', 'submit');
    expect(entry).toBeTruthy();
    expect(entry?.moduleKey).toBe('pages/foo.server');
  });

  it('returns undefined when the action name does not exist on the chain', async () => {
    const { byPath } = makePageActionResolvers(routes, { dev: false });
    const map = await byPath('/foo');
    expect(map.get('nope')).toBeUndefined();
  });

  it('rebuilds on every call in dev mode', async () => {
    let calls = 0;
    const dynamicThunk = async () => {
      calls++;
      return { __moduleKey: 'p', serverActions: { x: async () => 'ok' } };
    };
    const dynamicRoutes: ServerRoute[] = [
      { path: '/p', server: dynamicThunk, ancestors: [] } as unknown as ServerRoute,
    ];
    const { byPath } = makePageActionResolvers(dynamicRoutes, { dev: true });
    await byPath('/p');
    await byPath('/p');
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -w --filter @hono-preact/server test page-action-resolvers -- --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver factory**

Create `packages/server/src/page-action-resolvers.ts`:

```ts
import type { ServerRoute } from '@hono-preact/iso';

type ActionFn = (ctx: unknown, payload: unknown) => Promise<unknown>;

export type ActionEntry = {
  fn: ActionFn;
  use: ReadonlyArray<unknown>;
  timeoutMs?: number | false;
  moduleKey: string;
};

type ServerModule = {
  __moduleKey?: unknown;
  serverActions?: Record<string, unknown>;
};

function extractActions(
  mod: ServerModule
): Array<{ name: string; entry: ActionEntry }> {
  const moduleKey = mod.__moduleKey;
  if (typeof moduleKey !== 'string' || !mod.serverActions) return [];
  const out: Array<{ name: string; entry: ActionEntry }> = [];
  for (const [name, val] of Object.entries(mod.serverActions)) {
    if (typeof val !== 'function') continue;
    const metadata = val as {
      use?: ReadonlyArray<unknown>;
      timeoutMs?: number | false;
    };
    out.push({
      name,
      entry: {
        fn: val as ActionFn,
        use: metadata.use ?? [],
        timeoutMs: metadata.timeoutMs,
        moduleKey,
      },
    });
  }
  return out;
}

function segmentsOf(p: string): string[] {
  return p.split('/').filter((s) => s !== '');
}

function urlPathMatchesPattern(urlPath: string, pattern: string): boolean {
  const ps = segmentsOf(pattern);
  const us = segmentsOf(urlPath);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p === '*') return true;
    if (i >= us.length) return false;
    if (p.startsWith(':')) continue;
    if (p !== us[i]) return false;
  }
  return ps.length === us.length;
}

function patternScore(pattern: string): number {
  let score = 0;
  for (const seg of segmentsOf(pattern)) {
    if (seg === '*') score += 0;
    else if (seg.startsWith(':')) score += 1;
    else score += 2;
  }
  return score;
}

export function makePageActionResolvers(
  serverRoutes: ReadonlyArray<ServerRoute>,
  options: { dev?: boolean } = {}
) {
  const dev = options.dev ?? false;

  type Built = {
    byPathMap: Map<string, Map<string, ActionEntry>>;
    byModuleKey: Map<string, Map<string, ActionEntry>>; // moduleKey -> actionName -> entry
  };
  let buildPromise: Promise<Built> | null = null;

  const build = async (): Promise<Built> => {
    const thunkCache = new Map<() => Promise<unknown>, Promise<ServerModule>>();
    const load = (thunk: () => Promise<unknown>) => {
      let p = thunkCache.get(thunk);
      if (!p) {
        p = thunk().then((m) => m as ServerModule);
        thunkCache.set(thunk, p);
      }
      return p;
    };

    const byPathMap = new Map<string, Map<string, ActionEntry>>();
    const byModuleKey = new Map<string, Map<string, ActionEntry>>();

    await Promise.all(
      serverRoutes.map(async (route) => {
        const ancestorMods = await Promise.all(route.ancestors.map(load));
        const selfMod = await load(route.server);
        const merged = new Map<string, ActionEntry>();
        for (const mod of [...ancestorMods, selfMod]) {
          for (const { name, entry } of extractActions(mod)) {
            merged.set(name, entry);
            let m = byModuleKey.get(entry.moduleKey);
            if (!m) {
              m = new Map();
              byModuleKey.set(entry.moduleKey, m);
            }
            m.set(name, entry);
          }
        }
        byPathMap.set(route.path, merged);
      })
    );
    return { byPathMap, byModuleKey };
  };

  const get = () => {
    if (dev) return build();
    if (buildPromise) return buildPromise;
    buildPromise = build().catch((err) => {
      buildPromise = null;
      return Promise.reject(err);
    });
    return buildPromise;
  };

  return {
    async byPath(path: string): Promise<Map<string, ActionEntry>> {
      const { byPathMap } = await get();
      let bestPattern: string | null = null;
      let bestScore = -1;
      let bestDepth = -1;
      for (const pattern of byPathMap.keys()) {
        if (!urlPathMatchesPattern(path, pattern)) continue;
        const score = patternScore(pattern);
        const depth = segmentsOf(pattern).length;
        if (score > bestScore || (score === bestScore && depth > bestDepth)) {
          bestPattern = pattern;
          bestScore = score;
          bestDepth = depth;
        }
      }
      return bestPattern ? (byPathMap.get(bestPattern) ?? new Map()) : new Map();
    },
    async byModuleKey(
      moduleKey: string,
      actionName: string
    ): Promise<ActionEntry | undefined> {
      const { byModuleKey: m } = await get();
      return m.get(moduleKey)?.get(actionName);
    },
  };
}
```

- [ ] **Step 4: Export from server barrel**

Edit `packages/server/src/index.ts`, add:

```ts
export {
  makePageActionResolvers,
  type ActionEntry,
} from './page-action-resolvers.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -w --filter @hono-preact/server test page-action-resolvers -- --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/page-action-resolvers.ts packages/server/src/__tests__/page-action-resolvers.test.ts packages/server/src/index.ts
git commit -m "feat(server): makePageActionResolvers — actions resolved per page chain"
```

---

## Task 5: `pageActionHandler` — per-page POST handler with content negotiation

Replaces `actionsHandler`. Mounted by the generated server entry as the POST branch of the wildcard route. Handles JSON, multipart form data, and url-encoded bodies. Negotiates response: `text/html` (PE) vs `application/json` (RPC) vs `text/event-stream` (streaming).

**Files:**
- Create: `packages/server/src/page-action-handler.ts`
- Test: `packages/server/src/__tests__/page-action-handler.test.ts`
- Modify: `packages/server/src/index.ts` (export)

- [ ] **Step 1: Write failing tests for the handler**

Create `packages/server/src/__tests__/page-action-handler.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { pageActionHandler } from '../page-action-handler.js';
import { deny, redirect } from '@hono-preact/iso';

function buildHandler(actions: Record<string, (ctx: unknown, payload: unknown) => Promise<unknown>>) {
  const resolverByPath = async () => {
    const map = new Map();
    for (const [name, fn] of Object.entries(actions)) {
      map.set(name, { fn, use: [], moduleKey: 'pages/test.server' });
    }
    return map;
  };
  const renderPage = vi.fn(async (c, _node) => c.html('<!doctype html><body>RENDERED</body>'));
  return pageActionHandler({
    resolverByPath,
    renderPage: renderPage as never,
    resolvePageNode: () => null,  // tests pass a stub render
    appConfig: { use: [] },
  });
}

describe('pageActionHandler', () => {
  it('returns __outcome=success JSON envelope on Accept: application/json', async () => {
    const handler = buildHandler({
      submit: async () => ({ id: 42 }),
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module: 'pages/test.server', action: 'submit', payload: { x: 1 } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ __outcome: 'success', data: { id: 42 } });
  });

  it('returns real 303 on Accept: text/html when action returns data', async () => {
    const handler = buildHandler({ submit: async () => ({ id: 42 }) });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----b', Accept: 'text/html' },
      body: '------b\r\nContent-Disposition: form-data; name="__module"\r\n\r\npages/test.server\r\n------b\r\nContent-Disposition: form-data; name="__action"\r\n\r\nsubmit\r\n------b--\r\n',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/foo');
  });

  it('returns real 30x on Accept: text/html when action throws redirect()', async () => {
    const handler = buildHandler({
      submit: async () => {
        throw redirect('/next');
      },
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----b', Accept: 'text/html' },
      body: '------b\r\nContent-Disposition: form-data; name="__module"\r\n\r\npages/test.server\r\n------b\r\nContent-Disposition: form-data; name="__action"\r\n\r\nsubmit\r\n------b--\r\n',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/next');
  });

  it('re-renders the page with deny outcome injected on Accept: text/html', async () => {
    const handler = buildHandler({
      submit: async () => {
        throw deny(422, 'bad', { data: { fieldErrors: { x: ['nope'] } } });
      },
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----b', Accept: 'text/html' },
      body: '------b\r\nContent-Disposition: form-data; name="__module"\r\n\r\npages/test.server\r\n------b\r\nContent-Disposition: form-data; name="__action"\r\n\r\nsubmit\r\n------b--\r\n',
    });
    expect(res.status).toBe(422);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('RENDERED');
  });

  it('returns 405 when streaming action invoked without Accept: text/event-stream', async () => {
    async function* gen() {
      yield { tick: 1 };
    }
    const handler = buildHandler({ stream: async () => gen() });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/html' },
      body: JSON.stringify({ module: 'pages/test.server', action: 'stream', payload: {} }),
    });
    expect(res.status).toBe(405);
  });

  it('returns 404 when the action is not declared on the page chain', async () => {
    const handler = buildHandler({ submit: async () => 'ok' });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module: 'pages/test.server', action: 'missing', payload: {} }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -w --filter @hono-preact/server test page-action-handler -- --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pageActionHandler`**

Create `packages/server/src/page-action-handler.ts`:

```ts
import type { Context, MiddlewareHandler } from 'hono';
import {
  isOutcome,
  timeoutOutcome,
  type AppConfig,
  type ServerMiddleware,
  type ServerActionCtx,
  type Middleware,
  type StreamObserver,
} from '@hono-preact/iso';
import {
  runRequestScope,
  setActionResultSlot,
  dispatchServer,
  partitionUse,
  serializeActionOutcome,
  type ActionResolution,
} from '@hono-preact/iso/internal';
import {
  sseGeneratorResponse,
  sseReadableStreamResponse,
  isAsyncGenerator,
} from './sse.js';
import type { ActionEntry } from './page-action-resolvers.js';
import type { VNode } from 'preact';

export interface PageActionHandlerOptions {
  resolverByPath: (path: string) => Promise<Map<string, ActionEntry>>;
  renderPage: (
    c: Context,
    node: VNode,
    opts: { appConfig?: AppConfig }
  ) => Promise<Response>;
  resolvePageNode: (path: string) => VNode | null;
  appConfig?: AppConfig;
  defaultTimeoutMs?: number | false;
  onError?: (err: unknown, ctx: { module: string; action: string }) => void;
}

type Accept = 'html' | 'json' | 'event-stream';

function pickAccept(header: string | undefined): Accept {
  const h = (header ?? '').toLowerCase();
  if (h.includes('text/event-stream')) return 'event-stream';
  if (h.includes('application/json')) return 'json';
  return 'html'; // default browser behavior
}

async function parseBody(
  c: Context
): Promise<{ module: string; action: string; payload: unknown } | { error: string; status: 400 | 415 }> {
  const ct = (c.req.header('Content-Type') ?? '').toLowerCase();
  if (ct.startsWith('application/json')) {
    let body: { module?: unknown; action?: unknown; payload?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return { error: 'Invalid JSON body', status: 400 };
    }
    const { module: m, action: a, payload: p } = body;
    if (typeof m !== 'string' || typeof a !== 'string') {
      return { error: 'JSON body must include string fields: module, action', status: 400 };
    }
    return { module: m, action: a, payload: p };
  }
  if (
    ct.startsWith('multipart/form-data') ||
    ct.startsWith('application/x-www-form-urlencoded')
  ) {
    let fd: FormData;
    try {
      fd = await c.req.formData();
    } catch {
      return { error: 'Invalid form data', status: 400 };
    }
    const m = fd.get('__module');
    const a = fd.get('__action');
    if (typeof m !== 'string' || typeof a !== 'string') {
      return { error: 'Form data must include __module and __action fields', status: 400 };
    }
    const payload: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
    for (const [key, value] of fd.entries()) {
      if (key === '__module' || key === '__action') continue;
      const existing = payload[key];
      if (existing !== undefined) {
        payload[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        payload[key] = value;
      }
    }
    return { module: m, action: a, payload };
  }
  return { error: `Unsupported Content-Type: ${ct || '(empty)'}`, status: 415 };
}

export function pageActionHandler(
  opts: PageActionHandlerOptions
): MiddlewareHandler {
  const {
    resolverByPath,
    renderPage,
    resolvePageNode,
    appConfig,
    defaultTimeoutMs = 30_000,
    onError,
  } = opts;

  return async (c) => {
    const accept = pickAccept(c.req.header('Accept'));
    const parsed = await parseBody(c);
    if ('error' in parsed) {
      return accept === 'json'
        ? c.json({ __outcome: 'error', message: parsed.error }, parsed.status)
        : c.text(parsed.error, parsed.status);
    }
    const { module, action, payload } = parsed;
    const urlPath = new URL(c.req.url).pathname;
    const map = await resolverByPath(urlPath);
    const entry = map.get(action);
    if (!entry || entry.moduleKey !== module) {
      const msg = `Action '${action}' not found on '${urlPath}'`;
      return accept === 'json'
        ? c.json({ __outcome: 'error', message: msg }, 404)
        : c.text(msg, 404);
    }
    const { fn, use: actionUse, timeoutMs } = entry;
    const resolvedTimeoutMs: number | false =
      timeoutMs !== undefined ? timeoutMs : defaultTimeoutMs;
    const timeoutSignal =
      resolvedTimeoutMs === false ? undefined : AbortSignal.timeout(resolvedTimeoutMs);
    const signal = timeoutSignal
      ? AbortSignal.any([c.req.raw.signal, timeoutSignal])
      : c.req.raw.signal;
    const actionCtx = { c, signal };

    const rootUse = appConfig?.use ?? [];
    const fullUse: ReadonlyArray<Middleware | StreamObserver<unknown, never>> = [
      ...rootUse,
      ...actionUse,
    ] as ReadonlyArray<Middleware | StreamObserver<unknown, never>>;
    const { middleware: allMiddleware, observers } = partitionUse(fullUse);
    const serverMw = allMiddleware.filter(
      (m): m is ServerMiddleware<'action'> => m.runs === 'server'
    );
    const ctx: ServerActionCtx = {
      scope: 'action',
      c,
      signal,
      module,
      action,
      payload,
    };

    let resolution: ActionResolution;
    let streamingResult: AsyncGenerator<unknown> | ReadableStream<unknown> | undefined;
    try {
      const value = await runRequestScope(async () => {
        const dispatch = await dispatchServer<unknown, 'action'>({
          middleware: serverMw,
          ctx,
          inner: async () => {
            const inner = await fn(actionCtx, payload);
            if (isOutcome(inner)) throw inner;
            return inner;
          },
        });
        if (dispatch.kind === 'outcome') throw dispatch.outcome;
        return dispatch.value;
      });
      if (isAsyncGenerator(value) || value instanceof ReadableStream) {
        streamingResult = value as AsyncGenerator<unknown> | ReadableStream<unknown>;
        if (accept !== 'event-stream') {
          return c.text(
            'Streaming actions require Accept: text/event-stream',
            405
          );
        }
        // Streaming response below.
        resolution = { kind: 'success', data: undefined };
      } else {
        resolution = { kind: 'success', data: value };
      }
    } catch (err) {
      if (isOutcome(err)) {
        resolution = { kind: 'outcome', outcome: err };
      } else if (
        timeoutSignal?.aborted &&
        timeoutSignal.reason instanceof DOMException &&
        timeoutSignal.reason.name === 'TimeoutError' &&
        typeof resolvedTimeoutMs === 'number'
      ) {
        resolution = { kind: 'outcome', outcome: timeoutOutcome(resolvedTimeoutMs) };
      } else {
        onError?.(err, { module, action });
        resolution = { kind: 'error', message: 'Action failed' };
      }
    }

    // Streaming success path: hand off to SSE responders.
    if (streamingResult) {
      if (isAsyncGenerator(streamingResult)) {
        return sseGeneratorResponse(c, streamingResult, {
          emitResult: true,
          observers,
          observerCtx: ctx,
          signal: timeoutSignal,
          timeoutMs:
            typeof resolvedTimeoutMs === 'number' ? resolvedTimeoutMs : undefined,
        });
      }
      return sseReadableStreamResponse(c, streamingResult, {
        observers,
        observerCtx: ctx,
        signal: timeoutSignal,
        timeoutMs:
          typeof resolvedTimeoutMs === 'number' ? resolvedTimeoutMs : undefined,
      });
    }

    // JSON path.
    if (accept === 'json') {
      const env = serializeActionOutcome(resolution);
      if (env.headers) for (const [k, v] of Object.entries(env.headers)) c.header(k, v);
      return c.json(env.body, env.status as 200 | 504 | 500 | 422 | 401 | 403);
    }

    // HTML / PE path.
    if (resolution.kind === 'outcome' && resolution.outcome.__outcome === 'redirect') {
      const { to, status, headers } = resolution.outcome;
      if (headers) for (const [k, v] of Object.entries(headers)) c.header(k, v);
      return c.redirect(to, status);
    }
    if (resolution.kind === 'success') {
      // Auto 303 to current URL — loaders re-run on the GET.
      return c.redirect(urlPath, 303);
    }
    if (resolution.kind === 'outcome' && resolution.outcome.__outcome === 'timeout') {
      return c.text(`Action timed out after ${resolution.outcome.timeoutMs}ms`, 504);
    }
    // deny or error: re-render the page with the resolution injected.
    return await runRequestScope(async () => {
      setActionResultSlot({
        module,
        action,
        resolution,
        submittedPayload: payload,
      });
      const node = resolvePageNode(urlPath);
      if (!node) {
        // No matching page to render; fall back to text.
        if (resolution.kind === 'outcome' && resolution.outcome.__outcome === 'deny') {
          return c.text(resolution.outcome.message, resolution.outcome.status);
        }
        return c.text('Action failed', 500);
      }
      const res = await renderPage(c, node, { appConfig });
      if (resolution.kind === 'outcome' && resolution.outcome.__outcome === 'deny') {
        return new Response(res.body, {
          status: resolution.outcome.status,
          headers: res.headers,
        });
      }
      return new Response(res.body, { status: 500, headers: res.headers });
    });
  };
}
```

- [ ] **Step 4: Export from server barrel**

Edit `packages/server/src/index.ts`:

```ts
export { pageActionHandler, type PageActionHandlerOptions } from './page-action-handler.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm -w --filter @hono-preact/server test page-action-handler -- --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/page-action-handler.ts packages/server/src/__tests__/page-action-handler.test.ts packages/server/src/index.ts
git commit -m "feat(server): pageActionHandler with content negotiation"
```

---

## Task 6: `useActionResult` hook + `ActionResultContext`

**Files:**
- Create: `packages/iso/src/action-result-context.tsx`
- Create: `packages/iso/src/use-action-result.ts`
- Test: `packages/iso/src/__tests__/use-action-result.test.tsx`
- Modify: `packages/iso/src/index.ts` (export hook)
- Modify: `packages/server/src/render.tsx` (inject the SSR provider reading from `getActionResultSlot()`)

- [ ] **Step 1: Write failing tests**

Create `packages/iso/src/__tests__/use-action-result.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { ActionResultContext } from '../action-result-context.js';
import { useActionResult } from '../use-action-result.js';

function Reader({ stub }: { stub?: { __module: string; __action: string } }) {
  const r = useActionResult(stub as never);
  return <pre>{JSON.stringify(r)}</pre>;
}

describe('useActionResult', () => {
  it('returns null when no provider', () => {
    const { container } = render(<Reader />);
    expect(container.textContent).toBe('null');
  });

  it('returns the deny result with submittedPayload', () => {
    const value = {
      module: 'pages/foo.server',
      action: 'submit',
      kind: 'deny' as const,
      status: 422,
      message: 'bad',
      data: { fieldErrors: { x: ['nope'] } },
      submittedPayload: { text: 'hi' },
    };
    const { container } = render(
      <ActionResultContext.Provider value={value}>
        <Reader />
      </ActionResultContext.Provider>
    );
    expect(JSON.parse(container.textContent!)).toMatchObject({
      kind: 'deny',
      status: 422,
      message: 'bad',
      data: { fieldErrors: { x: ['nope'] } },
      submittedPayload: { text: 'hi' },
    });
  });

  it('filters by stub identity when stub passed', () => {
    const value = {
      module: 'pages/foo.server',
      action: 'submit',
      kind: 'success' as const,
      data: { id: 1 },
      submittedPayload: { x: 1 },
    };
    const { container } = render(
      <ActionResultContext.Provider value={value}>
        <Reader stub={{ __module: 'pages/other.server', __action: 'submit' }} />
      </ActionResultContext.Provider>
    );
    expect(container.textContent).toBe('null');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -w --filter @hono-preact/iso test use-action-result -- --run`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the context**

Create `packages/iso/src/action-result-context.tsx`:

```tsx
import { createContext } from 'preact';

export type ActionResultContextValue =
  | {
      module: string;
      action: string;
      kind: 'success';
      data: unknown;
      submittedPayload: unknown;
    }
  | {
      module: string;
      action: string;
      kind: 'deny';
      status: number;
      message: string;
      data?: unknown;
      submittedPayload: unknown;
    }
  | {
      module: string;
      action: string;
      kind: 'error';
      message: string;
      submittedPayload: unknown;
    }
  | null;

export const ActionResultContext = createContext<ActionResultContextValue>(null);
```

- [ ] **Step 4: Create the hook**

Create `packages/iso/src/use-action-result.ts`:

```ts
import { useContext } from 'preact/hooks';
import { ActionResultContext } from './action-result-context.js';
import type { ActionStub } from './action.js';

export type ActionResult<TPayload, TResult> =
  | { kind: 'success'; data: TResult; submittedPayload: TPayload }
  | {
      kind: 'deny';
      status: number;
      message: string;
      data?: unknown;
      submittedPayload: TPayload;
    }
  | {
      kind: 'error';
      message: string;
      submittedPayload: TPayload | null;
    }
  | null;

export function useActionResult<TPayload = unknown, TResult = unknown>(
  stub?: ActionStub<TPayload, TResult, never>
): ActionResult<TPayload, TResult> {
  const ctx = useContext(ActionResultContext);
  if (!ctx) return null;
  if (stub && (ctx.module !== stub.__module || ctx.action !== stub.__action)) {
    return null;
  }
  if (ctx.kind === 'success') {
    return {
      kind: 'success',
      data: ctx.data as TResult,
      submittedPayload: ctx.submittedPayload as TPayload,
    };
  }
  if (ctx.kind === 'deny') {
    return {
      kind: 'deny',
      status: ctx.status,
      message: ctx.message,
      data: ctx.data,
      submittedPayload: ctx.submittedPayload as TPayload,
    };
  }
  return {
    kind: 'error',
    message: ctx.message,
    submittedPayload: ctx.submittedPayload as TPayload | null,
  };
}
```

- [ ] **Step 5: Export from iso barrel**

Edit `packages/iso/src/index.ts`:

```ts
export { useActionResult, type ActionResult } from './use-action-result.js';
export {
  ActionResultContext,
  type ActionResultContextValue,
} from './action-result-context.js';
```

- [ ] **Step 6: Inject SSR provider in `renderPage`**

Read `packages/server/src/render.tsx` and find where `renderPage` constructs the VNode tree (likely near a `LoaderHost`-style wrap). Wrap the page node with the provider, reading from `getActionResultSlot()`:

```tsx
// At top of render.tsx (alongside existing imports):
import { ActionResultContext, type ActionResultContextValue } from '@hono-preact/iso';
import { getActionResultSlot } from '@hono-preact/iso/internal';

// Inside renderPage, where the page VNode tree is built (look for the
// existing wrap with `runRequestScope` and any LoaderHost provider):
function buildActionResultContext(): ActionResultContextValue {
  const slot = getActionResultSlot();
  if (!slot) return null;
  if (slot.resolution.kind === 'success') {
    return {
      module: slot.module,
      action: slot.action,
      kind: 'success',
      data: slot.resolution.data,
      submittedPayload: slot.submittedPayload,
    };
  }
  if (slot.resolution.kind === 'error') {
    return {
      module: slot.module,
      action: slot.action,
      kind: 'error',
      message: slot.resolution.message,
      submittedPayload: slot.submittedPayload,
    };
  }
  const { outcome } = slot.resolution;
  if (outcome.__outcome === 'deny') {
    return {
      module: slot.module,
      action: slot.action,
      kind: 'deny',
      status: outcome.status,
      message: outcome.message,
      data: outcome.data,
      submittedPayload: slot.submittedPayload,
    };
  }
  return null;
}

// Then wherever the existing page VNode is rendered, change from:
//   const tree = pageNode;
// to:
//   const tree = (
//     <ActionResultContext.Provider value={buildActionResultContext()}>
//       {pageNode}
//     </ActionResultContext.Provider>
//   );
```

Use the existing pattern from how `LoaderHost` or `HonoRequestContext.Provider` is wired in `render.tsx`; the action-result provider goes immediately outside (or alongside) those.

- [ ] **Step 7: Run iso tests + server tests**

Run: `pnpm -w --filter @hono-preact/iso test use-action-result -- --run`
Run: `pnpm -w --filter @hono-preact/server test -- --run`
Expected: PASS for the new test; existing render tests continue green.

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/action-result-context.tsx packages/iso/src/use-action-result.ts packages/iso/src/__tests__/use-action-result.test.tsx packages/iso/src/index.ts packages/server/src/render.tsx
git commit -m "feat(iso): useActionResult hook + ActionResultContext SSR injection"
```

---

## Task 7: `useFormStatus` hook + client submit store

The client store tracks in-flight submits keyed by `(module, action)`. `<Form>` and `useAction` will push/pop entries against it; `useFormStatus` reads from it on the client. On the server (SSR), the store is empty.

**Files:**
- Create: `packages/iso/src/internal/form-submit-store.ts`
- Create: `packages/iso/src/use-form-status.ts`
- Test: `packages/iso/src/__tests__/use-form-status.test.tsx`
- Modify: `packages/iso/src/internal.ts` (re-export store)
- Modify: `packages/iso/src/index.ts` (export hook)

- [ ] **Step 1: Write failing tests**

Create `packages/iso/src/__tests__/use-form-status.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import { render } from '@testing-library/preact';
import { useFormStatus } from '../use-form-status.js';
import { beginSubmit, endSubmit } from '../internal/form-submit-store.js';

function Reader({ stub }: { stub?: { __module: string; __action: string } }) {
  const { pending } = useFormStatus(stub as never);
  return <span>{pending ? 'pending' : 'idle'}</span>;
}

describe('useFormStatus', () => {
  it('returns idle when no submits in flight', () => {
    const { container } = render(<Reader />);
    expect(container.textContent).toBe('idle');
  });

  it('reflects an in-flight submit globally (no stub)', () => {
    const { container } = render(<Reader />);
    act(() => beginSubmit('pages/foo.server', 'submit'));
    expect(container.textContent).toBe('pending');
    act(() => endSubmit('pages/foo.server', 'submit'));
    expect(container.textContent).toBe('idle');
  });

  it('filters by stub identity when stub passed', () => {
    const stub = { __module: 'pages/foo.server', __action: 'submit' };
    const { container } = render(<Reader stub={stub} />);
    act(() => beginSubmit('pages/other.server', 'submit'));
    expect(container.textContent).toBe('idle');
    act(() => beginSubmit(stub.__module, stub.__action));
    expect(container.textContent).toBe('pending');
    act(() => endSubmit(stub.__module, stub.__action));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -w --filter @hono-preact/iso test use-form-status -- --run`
Expected: FAIL.

- [ ] **Step 3: Create the store**

Create `packages/iso/src/internal/form-submit-store.ts`:

```ts
type Key = string; // `${module}::${action}`
type Listener = () => void;

const counts = new Map<Key, number>();
const listeners = new Set<Listener>();

function key(module: string, action: string): Key {
  return `${module}::${action}`;
}

export function beginSubmit(module: string, action: string): void {
  const k = key(module, action);
  counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const l of listeners) l();
}

export function endSubmit(module: string, action: string): void {
  const k = key(module, action);
  const n = (counts.get(k) ?? 0) - 1;
  if (n <= 0) counts.delete(k);
  else counts.set(k, n);
  for (const l of listeners) l();
}

export function isPending(stub?: { __module: string; __action: string }): boolean {
  if (stub) return (counts.get(key(stub.__module, stub.__action)) ?? 0) > 0;
  return counts.size > 0;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
```

- [ ] **Step 4: Create the hook**

Create `packages/iso/src/use-form-status.ts`:

```ts
import { useSyncExternalStore } from 'preact/compat';
import type { ActionStub } from './action.js';
import { isPending, subscribe } from './internal/form-submit-store.js';

export type FormStatus = { pending: boolean };

export function useFormStatus(
  stub?: ActionStub<unknown, unknown, never>
): FormStatus {
  const pending = useSyncExternalStore(
    subscribe,
    () => isPending(stub),
    () => false  // SSR: always idle
  );
  return { pending };
}
```

- [ ] **Step 5: Re-export from barrels**

Edit `packages/iso/src/internal.ts`:

```ts
export {
  beginSubmit,
  endSubmit,
  isPending,
  subscribe,
} from './internal/form-submit-store.js';
```

Edit `packages/iso/src/index.ts`:

```ts
export { useFormStatus, type FormStatus } from './use-form-status.js';
```

- [ ] **Step 6: Run tests**

Run: `pnpm -w --filter @hono-preact/iso test use-form-status -- --run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/form-submit-store.ts packages/iso/src/use-form-status.ts packages/iso/src/__tests__/use-form-status.test.tsx packages/iso/src/internal.ts packages/iso/src/index.ts
git commit -m "feat(iso): useFormStatus hook + in-flight submit store"
```

---

## Task 8: Rewrite `useAction` to target the current page URL with the new envelope

Internals only. Public hook return shape is unchanged. The fetch URL switches from `/__actions` to `window.location.pathname`, the request body keeps `module` / `action` / `payload`, and the response parser reads the uniform `__outcome`-tagged envelope (including the new `__outcome: 'success'` wrapping). Removes the `response.clone().json()` redirect-peek hack. Pushes into / out of the submit store around the fetch.

**Files:**
- Modify: `packages/iso/src/action.ts`
- Modify: `packages/iso/src/__tests__/action.test.tsx` (existing tests will fail until updated)

- [ ] **Step 1: Read current action.ts and the relevant tests**

Run: `wc -l packages/iso/src/action.ts packages/iso/src/__tests__/action.test.tsx`
Read both files (Read tool). Note all test cases that mock fetch — they all need updated URLs and envelope shapes.

- [ ] **Step 2: Update `useAction` tests to the new envelope and URL**

Edit every test in `packages/iso/src/__tests__/action.test.tsx` so that:

- Mocked `fetch` URLs match `window.location.pathname` (set via `Object.defineProperty(window, 'location', { value: new URL('http://localhost/test') })` in `beforeEach`, or via vitest-environment-jsdom defaults plus an explicit override).
- Success responses return JSON `{ __outcome: 'success', data: <TResult> }` instead of bare `<TResult>`.
- Redirect responses return JSON `{ __outcome: 'redirect', to, status }` (still HTTP 200).
- Deny responses return JSON `{ __outcome: 'deny', status, message, data? }` with HTTP `status`.
- Error responses return JSON `{ __outcome: 'error', message }` with HTTP 500.
- Timeout responses return JSON `{ __outcome: 'timeout', timeoutMs }` with HTTP 504.

Add at least one new test asserting `beginSubmit` / `endSubmit` are called around the fetch (use a `subscribe()` listener to assert pending transitions).

Run: `pnpm -w --filter @hono-preact/iso test action.test -- --run`
Expected: FAIL — implementation still uses old shape.

- [ ] **Step 3: Rewrite `useAction` request and response logic**

In `packages/iso/src/action.ts`, replace the body of the `mutate` callback. The inputs and outputs of the public hook stay the same; only the fetch URL, the request body shape (unchanged), and the response parsing change.

Key changes:

```ts
// Replace `fetch('/__actions', ...)` with:
const target =
  typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
const acceptHeader =
  // streaming actions (TChunk extends not-never) request SSE; otherwise JSON.
  // The runtime guard mirrors the type: detect by inspecting the
  // `stub.__phantom` marker is not viable at runtime, so we always request
  // `application/json, text/event-stream;q=0.9` and let the server pick.
  'application/json, text/event-stream;q=0.9';

import { beginSubmit, endSubmit } from './internal/form-submit-store.js';

// Around the fetch:
beginSubmit(currentStub.__module, currentStub.__action);
try {
  // ... fetch logic ...
} finally {
  endSubmit(currentStub.__module, currentStub.__action);
}
```

Replace the response-handling block. Pseudocode for the new shape (full implementation, no placeholders):

```ts
const contentType = response.headers.get('Content-Type') ?? '';
if (contentType.includes('text/event-stream') && response.body) {
  // ... existing SSE handling stays unchanged (wire format from PR #58) ...
} else {
  let env: {
    __outcome?: string;
    data?: unknown;
    to?: string;
    status?: number;
    message?: string;
    timeoutMs?: number;
  };
  try {
    env = (await response.json()) as typeof env;
  } catch {
    throw new Error(`Malformed envelope (HTTP ${response.status})`);
  }
  if (env.__outcome === 'success') {
    const data = env.data as TResult;
    setData(data);
    invokeSuccess(data);
    finalResult = data;
  } else if (env.__outcome === 'redirect' && typeof env.to === 'string') {
    if (typeof window !== 'undefined') window.location.assign(env.to);
    return await new Promise<MutateResult<TResult>>(() => {});
  } else if (env.__outcome === 'deny') {
    const msg = env.message ?? `Request denied (${env.status ?? response.status})`;
    const err = new Error(msg) as Error & { data?: unknown; status?: number };
    err.status = env.status ?? response.status;
    if (env.data !== undefined) err.data = env.data;
    throw err;
  } else if (env.__outcome === 'timeout' && typeof env.timeoutMs === 'number') {
    throw new TimeoutError(env.timeoutMs);
  } else if (env.__outcome === 'error') {
    throw new Error(env.message ?? 'Action failed');
  } else {
    throw new Error(`Unknown action outcome: ${env.__outcome}`);
  }
}
```

Remove the `response.clone().json()` redirect-peek block entirely.

Send the `Accept` header on the request (and keep the existing `Content-Type` logic):

```ts
// JSON path:
response = await fetch(target, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: acceptHeader },
  body: JSON.stringify({
    module: currentStub.__module,
    action: currentStub.__action,
    payload,
  }),
});
// FormData path: omit Content-Type (browser sets it), add Accept:
response = await fetch(target, { method: 'POST', body: fd, headers: { Accept: acceptHeader } });
```

- [ ] **Step 4: Run action tests**

Run: `pnpm -w --filter @hono-preact/iso test action.test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/__tests__/action.test.tsx
git commit -m "feat(iso): useAction targets page URL, reads uniform envelope"
```

---

## Task 9: Extend `useOptimisticAction` return value with stub-shape + brand

The return value becomes assignable to `ActionStub<TPayload, TResult, never>`. A private `Symbol` marks the binding so `<Form>` (Task 10) can detect it and call the optimistic apply.

**Files:**
- Modify: `packages/iso/src/optimistic-action.ts`
- Test: `packages/iso/src/__tests__/optimistic-action.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append to `packages/iso/src/__tests__/optimistic-action.test.ts`:

```ts
import { renderHook } from '@testing-library/preact';
import { defineAction } from '../action.js';
import { useOptimisticAction, OPTIMISTIC_BRAND } from '../optimistic-action.js';

describe('useOptimisticAction stub-compatibility', () => {
  const stub = defineAction(async (_ctx, p: { text: string }) => ({ id: 1, ...p }), {
    __module: 'pages/test.server',
    __action: 'addTodo',
  });
  const apply = (current: { text: string }[], payload: { text: string }) => [
    ...current,
    payload,
  ];

  it('return value carries __module and __action from the stub', () => {
    const { result } = renderHook(() =>
      useOptimisticAction(stub, { base: [], apply })
    );
    expect(result.current.__module).toBe('pages/test.server');
    expect(result.current.__action).toBe('addTodo');
  });

  it('return value carries the OPTIMISTIC_BRAND with apply and addOptimistic', () => {
    const { result } = renderHook(() =>
      useOptimisticAction(stub, { base: [], apply })
    );
    const brand = (result.current as unknown as Record<symbol, unknown>)[OPTIMISTIC_BRAND];
    expect(brand).toBeTruthy();
    const binding = brand as { apply: typeof apply; addOptimistic: (p: { text: string }) => unknown };
    expect(typeof binding.apply).toBe('function');
    expect(typeof binding.addOptimistic).toBe('function');
    expect(binding.apply([], { text: 'a' })).toEqual([{ text: 'a' }]);
  });

  it('return value still satisfies the imperative UseActionResult shape', () => {
    const { result } = renderHook(() =>
      useOptimisticAction(stub, { base: [], apply })
    );
    expect(typeof result.current.mutate).toBe('function');
    expect(result.current.pending).toBe(false);
    expect(result.current.value).toEqual([]);
  });
});
```

Note: this file likely uses a different existing harness (e.g. a `vi.fn()` fetch mock + custom test component). Adapt the `renderHook` calls above to match the project's existing pattern if `renderHook` from `@testing-library/preact` is not how the file currently invokes the hook. The assertions themselves (field names, types) are independent of the harness.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -w --filter @hono-preact/iso test optimistic-action -- --run`
Expected: FAIL — `OPTIMISTIC_BRAND` not exported; new fields missing.

- [ ] **Step 3: Reshape `useOptimisticAction` return value**

Edit `packages/iso/src/optimistic-action.ts`:

```ts
export const OPTIMISTIC_BRAND: unique symbol = Symbol('hono-preact.optimistic');

export type OptimisticBinding<TPayload, TBase> = {
  apply: (current: TBase, payload: TPayload) => TBase;
  // Hook into the optimistic settle/revert lifecycle. The Form uses
  // `addOptimistic(payload)` returned from useOptimistic to drive the
  // overlay; we expose `addOptimistic` directly so <Form> and useAction
  // can both invoke it without re-running the hook.
  addOptimistic: (payload: TPayload) => OptimisticHandle;
};

export type UseOptimisticActionResult<TPayload, TResult, TBase> =
  ActionStub<TPayload, TResult, never> &
    UseActionResult<TPayload, TResult> & {
      value: TBase;
      readonly [OPTIMISTIC_BRAND]: OptimisticBinding<TPayload, TBase>;
    };
```

In the hook body, build the return value to include the stub fields and brand:

```ts
const [value, addOptimistic] = useOptimistic(base, apply, { transition });

const action = useAction<TPayload, TResult, never, OptimisticHandle>(stub, {
  ...actionOpts,
  onMutate: (payload) => addOptimistic(payload),
  onSuccess: (data, handle) => {
    handle.settle();
    onSuccess?.(data);
  },
  onError: (err, handle) => {
    handle.revert();
    onError?.(err);
  },
});

// `useAction` here is the JS-on imperative path; <Form> takes the
// OPTIMISTIC_BRAND route below.

return {
  __module: stub.__module,
  __action: stub.__action,
  // useAction(...) is the hook on the stub; expose the underlying stub's
  // useAction so consumers who pass this to `useAction(result)` still work.
  useAction: stub.useAction,
  ...action,
  value,
  [OPTIMISTIC_BRAND]: { apply, addOptimistic },
};
```

Update `UseOptimisticActionOptions` if the existing options block needs reshaping; otherwise leave it alone.

- [ ] **Step 4: Run tests**

Run: `pnpm -w --filter @hono-preact/iso test optimistic-action -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/optimistic-action.ts packages/iso/src/__tests__/optimistic-action.test.ts
git commit -m "feat(iso): useOptimisticAction return is stub-compatible + branded"
```

---

## Task 10: Rewrite `<Form>` — `action={stub}`, hidden inputs, JS-on intercept, brand detection

**Files:**
- Modify: `packages/iso/src/form.tsx`
- Modify: `packages/iso/src/__tests__/form.test.tsx` (full rewrite — old API gone)

- [ ] **Step 1: Replace the form test file with the new contract**

Rewrite `packages/iso/src/__tests__/form.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { Form } from '../form.js';
import type { ActionStub } from '../action.js';

function makeStub(): ActionStub<{ text: string }, { id: number }, never> {
  const stub = (async () => ({ id: 1 })) as unknown as ActionStub<
    { text: string },
    { id: number },
    never
  >;
  (stub as unknown as { __module: string; __action: string; useAction: unknown }).__module =
    'pages/test.server';
  (stub as unknown as { __module: string; __action: string; useAction: unknown }).__action =
    'submit';
  return stub;
}

describe('<Form>', () => {
  it('renders no action attribute (posts to current URL)', () => {
    const { container } = render(<Form action={makeStub()} />);
    const form = container.querySelector('form')!;
    expect(form.getAttribute('action')).toBeNull();
    expect(form.getAttribute('method')?.toLowerCase()).toBe('post');
  });

  it('emits __module and __action as hidden inputs', () => {
    const { container } = render(<Form action={makeStub()} />);
    const m = container.querySelector('input[name="__module"]') as HTMLInputElement;
    const a = container.querySelector('input[name="__action"]') as HTMLInputElement;
    expect(m.value).toBe('pages/test.server');
    expect(a.value).toBe('submit');
    expect(m.type).toBe('hidden');
    expect(a.type).toBe('hidden');
  });

  it('renders enctype=multipart/form-data', () => {
    const { container } = render(<Form action={makeStub()} />);
    const form = container.querySelector('form')!;
    expect(form.getAttribute('enctype')).toBe('multipart/form-data');
  });

  it('renders the fieldset wrapper for children', () => {
    const { container } = render(
      <Form action={makeStub()}>
        <input name="text" defaultValue="hi" />
      </Form>
    );
    const fieldset = container.querySelector('fieldset.hp-form-fieldset')!;
    const input = fieldset.querySelector('input[name="text"]') as HTMLInputElement;
    expect(input.value).toBe('hi');
  });

  it('intercepts submit, calls fetch with FormData and Accept: application/json', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ __outcome: 'success', data: { id: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    const { container } = render(
      <Form action={makeStub()}>
        <input name="text" defaultValue="hi" />
        <button type="submit">go</button>
      </Form>
    );
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('Accept')).toMatch(/application\/json/);
    fetchMock.mockRestore();
  });
});
```

Run: `pnpm -w --filter @hono-preact/iso test form -- --run`
Expected: FAIL — old `<Form>` doesn't take `action={stub}`.

- [ ] **Step 2: Rewrite `<Form>`**

Replace the body of `packages/iso/src/form.tsx`:

```tsx
import type { JSX, ComponentChildren } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import type { ActionStub } from './action.js';
import { OPTIMISTIC_BRAND } from './optimistic-action.js';
import { beginSubmit, endSubmit } from './internal/form-submit-store.js';

export type FormProps<TPayload, TResult> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'action' | 'method' | 'onSubmit' | 'enctype'
> & {
  action: ActionStub<TPayload, TResult, never>;
  children?: ComponentChildren;
};

function collectFormData(fd: FormData): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const out: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const [key, value] of fd.entries()) {
    if (key === '__module' || key === '__action') continue;
    const existing = out[key];
    out[key] =
      existing === undefined
        ? value
        : Array.isArray(existing)
          ? [...existing, value]
          : [existing, value];
  }
  return out;
}

export function Form<TPayload, TResult>({
  action,
  children,
  ...rest
}: FormProps<TPayload, TResult>) {
  const [pending, setPending] = useState(false);
  const moduleKey = action.__module;
  const actionName = action.__action;
  const optimistic = (action as unknown as Record<symbol, unknown>)[OPTIMISTIC_BRAND] as
    | { addOptimistic: (payload: TPayload) => { settle(): void; revert(): void } }
    | undefined;

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      const formEl = e.currentTarget as HTMLFormElement;
      const target =
        typeof window !== 'undefined'
          ? window.location.pathname + window.location.search
          : '/';
      const fd = new FormData(formEl);
      const payload = collectFormData(fd) as TPayload;
      let handle: { settle(): void; revert(): void } | undefined;
      if (optimistic) handle = optimistic.addOptimistic(payload);

      setPending(true);
      beginSubmit(moduleKey, actionName);
      try {
        const res = await fetch(target, {
          method: 'POST',
          body: fd,
          headers: { Accept: 'application/json' },
        });
        const env = (await res.json().catch(() => null)) as
          | { __outcome?: string; to?: string; message?: string; data?: unknown; status?: number }
          | null;
        if (!env) {
          handle?.revert();
          // Best-effort: trigger a real navigation so user sees a fresh page.
          if (typeof window !== 'undefined') window.location.reload();
          return;
        }
        if (env.__outcome === 'redirect' && typeof env.to === 'string') {
          if (typeof window !== 'undefined') window.location.assign(env.to);
          handle?.settle();
          return;
        }
        if (env.__outcome === 'success') {
          handle?.settle();
          // Loader reload integration is wired via reload-context elsewhere; the
          // <Form> on its own does not own loader invalidation. Devs who want
          // a refresh use useReload() or pass invalidate via useAction.
          return;
        }
        handle?.revert();
      } catch {
        handle?.revert();
      } finally {
        setPending(false);
        endSubmit(moduleKey, actionName);
      }
    },
    [moduleKey, actionName, optimistic]
  );

  return (
    <form {...rest} method="post" enctype="multipart/form-data" onSubmit={handleSubmit}>
      <input type="hidden" name="__module" value={moduleKey} />
      <input type="hidden" name="__action" value={actionName} />
      <fieldset disabled={pending} class="hp-form-fieldset">
        {children}
      </fieldset>
    </form>
  );
}
```

- [ ] **Step 3: Run form tests**

Run: `pnpm -w --filter @hono-preact/iso test form -- --run`
Expected: PASS.

- [ ] **Step 4: Run the whole iso suite**

Run: `pnpm -w --filter @hono-preact/iso test -- --run`
Expected: PASS (no regressions in adjacent suites).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/form.tsx packages/iso/src/__tests__/form.test.tsx
git commit -m "feat(iso): <Form action={stub}> with PE hidden inputs and JS-on intercept"
```

---

## Task 11: Update the generated server entry — drop `/__actions`, wildcard handles GET+POST

**Files:**
- Modify: `packages/vite/src/server-entry.ts`
- Modify: `packages/vite/src/__tests__/server-entry.test.ts` (assertions about the emitted source)

- [ ] **Step 1: Update test assertions**

Read `packages/vite/src/__tests__/server-entry.test.ts`. Any assertion that the emitted source contains `.post('/__actions', actionsHandler(` or `actionsHandler,` in the import list needs to change to assert the new mounts:

- Imports should now include `pageActionHandler` and `makePageActionResolvers`, NOT `actionsHandler`.
- Mounts should include `.post('*', pageActionHandler(...))` and `.get('*', (c) => renderPage(...))`, NOT `.post('/__actions', actionsHandler(...))`.

Run: `pnpm -w --filter @hono-preact/vite test server-entry -- --run`
Expected: FAIL.

- [ ] **Step 2: Update the generated source template**

Edit `packages/vite/src/server-entry.ts`. In the template string near line 30, change the imports and mounts:

```ts
// Old:
//   `  actionsHandler,\n` +
//   `  loadersHandler,\n` +
//   `  makePageUseResolvers,\n` +
//   `  renderPage,\n` +
//   `  routeServerModules,\n` +
// New:
const importsBlock =
  `import {\n` +
  `  loadersHandler,\n` +
  `  makePageUseResolvers,\n` +
  `  makePageActionResolvers,\n` +
  `  pageActionHandler,\n` +
  `  renderPage,\n` +
  `  routeServerModules,\n` +
  `} from 'hono-preact/server';\n`;
```

And the route mounts:

```ts
// Old:
//   `  .post('/__loaders', loadersHandler(serverModules, { dev, appConfig, resolvePageUse: pageUseResolvers.byPath }))\n` +
//   `  .post('/__actions', actionsHandler(serverModules, { dev, appConfig, resolvePageUse: pageUseResolvers.byModuleKey }))\n` +
//   `  .get('*', (c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes }))), { appConfig }));\n` +
// New (insert before the wildcard GET):
const mountsBlock =
  `  .post('/__loaders', loadersHandler(serverModules, { dev, appConfig, resolvePageUse: pageUseResolvers.byPath }))\n` +
  `  .post('*', pageActionHandler({\n` +
  `    resolverByPath: pageActionResolvers.byPath,\n` +
  `    renderPage,\n` +
  `    resolvePageNode: () => h(Layout, null, h(LocationProvider, null, h(Routes, { routes }))),\n` +
  `    appConfig,\n` +
  `  }))\n` +
  `  .get('*', (c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes }))), { appConfig }));\n`;
```

And add the resolver construction line near the existing `pageUseResolvers`:

```ts
// Just before the .post lines:
`const pageActionResolvers = makePageActionResolvers(routes.serverRoutes, { dev });\n` +
```

- [ ] **Step 3: Run server-entry tests**

Run: `pnpm -w --filter @hono-preact/vite test server-entry -- --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts
git commit -m "feat(vite): generated server entry mounts pageActionHandler"
```

---

## Task 12: End-to-end no-JS integration test

A Vitest test that boots the demo's generated entry (or constructs a Hono app from the same parts) and sends a real `multipart/form-data` POST with `Accept: text/html`, asserts the response is HTML containing the deny message and field error.

**Files:**
- Create: `packages/server/src/__tests__/pe-form-no-js.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create the file with a self-contained fixture that:

1. Defines a small inline page `.server.ts`-style module with `serverActions = { submit: async (_ctx, p) => throw deny(422, 'bad', { data: { fieldErrors: { text: ['required'] } } }) }`.
2. Wraps it in a `ServerRoute` array with the right ancestors and `__moduleKey`.
3. Builds a Hono app: `new Hono().post('*', pageActionHandler({ ... })).get('*', renderPage(...))`.
4. Issues `app.request('/test', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=----b', Accept: 'text/html' }, body: <multipart with __module, __action, text fields> })`.
5. Asserts:
   - HTTP status is 422
   - Content-Type starts with `text/html`
   - Response body contains the rendered page HTML (use a minimal `Layout` that emits a stable marker like `<main data-test="page">`)
   - The page reads `useActionResult()` and renders the deny message inline — asserted by matching `bad` and `required` in the body text

Full code:

```ts
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { Hono } from 'hono';
import { LocationProvider } from 'preact-iso';
import {
  pageActionHandler,
  makePageActionResolvers,
  renderPage,
} from '../index.js';
import {
  deny,
  useActionResult,
  ActionResultContext,
  type ServerRoute,
} from '@hono-preact/iso';

function Page() {
  const r = useActionResult();
  return h(
    'main',
    { 'data-test': 'page' },
    r?.kind === 'deny'
      ? h(
          'div',
          { class: 'errors' },
          h('p', null, r.message),
          h(
            'p',
            null,
            ((r.data as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
              ?.text ?? []).join(', ')
          )
        )
      : h('p', null, 'no errors')
  );
}

function Layout({ children }: { children: unknown }) {
  return h('html', null, h('body', null, children as never));
}

const submit = async () => {
  throw deny(422, 'bad', { data: { fieldErrors: { text: ['required'] } } });
};

const serverModule = {
  __moduleKey: 'pages/test.server',
  serverActions: { submit },
};

const serverThunk = async () => serverModule;

const routes: ServerRoute[] = [
  { path: '/test', server: serverThunk, ancestors: [] } as unknown as ServerRoute,
];

const multipartBody =
  '------b\r\n' +
  'Content-Disposition: form-data; name="__module"\r\n\r\n' +
  'pages/test.server\r\n' +
  '------b\r\n' +
  'Content-Disposition: form-data; name="__action"\r\n\r\n' +
  'submit\r\n' +
  '------b\r\n' +
  'Content-Disposition: form-data; name="text"\r\n\r\n' +
  '\r\n' +
  '------b--\r\n';

describe('PE form, no JS', () => {
  it('re-renders the page with deny outcome on text/html POST', async () => {
    const pageActionResolvers = makePageActionResolvers(routes, { dev: true });
    const node = h(Layout, null, h(LocationProvider, null, h(Page, null)));
    const app = new Hono()
      .post(
        '*',
        pageActionHandler({
          resolverByPath: pageActionResolvers.byPath,
          renderPage,
          resolvePageNode: () => node,
        })
      )
      .get('*', (c) => renderPage(c, node, {}));

    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=----b',
        Accept: 'text/html',
      },
      body: multipartBody,
    });

    expect(res.status).toBe(422);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('data-test="page"');
    expect(body).toContain('bad');
    expect(body).toContain('required');
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm -w --filter @hono-preact/server test pe-form-no-js -- --run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/pe-form-no-js.integration.test.ts
git commit -m "test(server): PE form no-JS integration smoke (deny re-render)"
```

---

## Task 13: Migrate demo `<Form>` and `useAction` call sites

Three files use `<Form mutate={...} pending={...}>` and need the new shape: `apps/site/src/pages/demo/login.tsx`, `project-issues.tsx`, `issue.tsx`. One additional file uses `useAction` for a non-form mutation: `projects.tsx`; that one only needs verification that the call still type-checks (signature unchanged).

**Files:**
- Modify: `apps/site/src/pages/demo/login.tsx`
- Modify: `apps/site/src/pages/demo/project-issues.tsx`
- Modify: `apps/site/src/pages/demo/issue.tsx`

- [ ] **Step 1: Migrate `login.tsx`**

Read the file. Replace the form usage from:

```tsx
const { mutate, pending } = useAction(serverActions.login, { ... });
// ...
<Form mutate={mutate} pending={pending} class="space-y-3">
```

To:

```tsx
<Form action={serverActions.login} class="space-y-3">
```

Remove the `useAction` call (no longer needed unless other code uses `pending` / `error` from it; if so, switch those to `useFormStatus(serverActions.login)` and `useActionResult(serverActions.login)`).

- [ ] **Step 2: Migrate `project-issues.tsx`**

Same pattern. The existing `useAction(serverActions.createIssue, { ... })` becomes either:

- Removed entirely if the form is the only invocation; pass the stub directly to `<Form>`.
- Kept if there are also non-form callers; the `<Form action={createIssueStub}>` still uses the stub directly (not the hook's `mutate`).

If the existing code reads `pending: creating` for a separate spinner outside the fieldset, switch to:

```tsx
const { pending: creating } = useFormStatus(serverActions.createIssue);
```

- [ ] **Step 3: Migrate `issue.tsx`**

Same pattern. Apply identical changes.

- [ ] **Step 4: Type-check the site app**

Run: `pnpm -w --filter site typecheck`
(If the site doesn't have a `typecheck` script, run: `pnpm -w --filter site tsc --noEmit`.)
Expected: 0 errors.

- [ ] **Step 5: Build the site to confirm the integrated path works**

Run: `pnpm -w --filter site build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/demo/login.tsx apps/site/src/pages/demo/project-issues.tsx apps/site/src/pages/demo/issue.tsx
git commit -m "feat(site): migrate demo forms to <Form action={stub}>"
```

---

## Task 14: Delete the legacy `actionsHandler` and its tests

After all consumers are migrated, remove the dead code.

**Files:**
- Delete: `packages/server/src/actions-handler.ts`
- Delete: `packages/server/src/__tests__/actions-handler.test.ts`
- Delete: `packages/server/src/__tests__/actions-handler-timeout.test.ts`
- Modify: `packages/server/src/index.ts` (remove export)
- Modify: `packages/server/src/__tests__/action-loader-revalidation.test.tsx` (rewrite against `pageActionHandler` if it imports `actionsHandler`)
- Modify: `packages/server/src/__tests__/middleware-chain.test.ts` (same)

- [ ] **Step 1: Find every remaining reference**

Run: `grep -rn "actionsHandler\|actions-handler" packages apps docs --include="*.ts" --include="*.tsx" --include="*.md"`
Make a list. Each one must either be deleted, rewritten to use `pageActionHandler`, or (for docs/spec breadcrumbs) updated to reflect the new shape.

- [ ] **Step 2: Rewrite `action-loader-revalidation.test.tsx`**

The test exercises the action→loader revalidation flow. Replace the `actionsHandler` setup with a `pageActionHandler({ resolverByPath, renderPage, resolvePageNode, appConfig })` setup. Adapt request URLs from `/__actions` to the page URL. Update response-shape assertions to read the uniform `__outcome` envelope.

- [ ] **Step 3: Rewrite `middleware-chain.test.ts`**

Same approach: swap `actionsHandler` → `pageActionHandler`; update URLs; update envelope assertions.

- [ ] **Step 4: Delete the files**

```bash
git rm packages/server/src/actions-handler.ts \
  packages/server/src/__tests__/actions-handler.test.ts \
  packages/server/src/__tests__/actions-handler-timeout.test.ts
```

- [ ] **Step 5: Remove the export**

Edit `packages/server/src/index.ts`, delete the `export { actionsHandler, ... } from './actions-handler.js';` line.

- [ ] **Step 6: Verify no dangling references remain**

Run: `grep -rn "actionsHandler\|actions-handler" packages apps --include="*.ts" --include="*.tsx"`
Expected: no results.

- [ ] **Step 7: Run all server tests**

Run: `pnpm -w --filter @hono-preact/server test -- --run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/__tests__/action-loader-revalidation.test.tsx packages/server/src/__tests__/middleware-chain.test.ts
git commit -m "refactor(server): remove legacy actionsHandler"
```

---

## Task 15: Update framework docs

Rewrite the actions/forms docs to describe the new shape. Per `feedback_docs_no_migration_breadcrumbs`, describe what *is*, not what changed.

**Files:**
- Modify: `apps/site/src/docs/actions.mdx` (or equivalent — `find apps/site/src -name "*.mdx" | xargs grep -l "useAction\|<Form\|/__actions"` to locate)
- Modify: `apps/site/src/docs/forms.mdx` (or equivalent)
- Modify: `apps/site/src/docs/streaming.mdx` — add a note that streaming actions cannot be used with `<Form>` (TypeScript will reject the prop)

- [ ] **Step 1: Find the docs files**

Run: `find apps/site/src -name "*.mdx" | xargs grep -l "useAction\|<Form\|/__actions" 2>/dev/null`
Read each one (Read tool) to understand the current narrative.

- [ ] **Step 2: Rewrite the actions/forms docs around the new shape**

For each docs file, update:

- Code samples: `<Form action={myAction}>` instead of `<Form mutate={...} pending={...}>`.
- New hooks: explain `useActionResult`, `useFormStatus`, and how they relate to `useAction`.
- `deny()` with `data` for field errors: include a Zod-style validation snippet matching the spec.
- PE behavior: explicitly describe that no-JS submissions are first-class and what happens (303 on success/explicit redirect, page re-render on deny).
- Remove any mention of `/__actions`. The endpoint no longer exists; the docs should describe the new "actions are POSTs to the page" model directly.

- [ ] **Step 3: Update `streaming.mdx`**

Add (or update) a section noting that streaming actions can only be invoked via the JS-on path (`useAction` with the SSE consumer); they cannot be used with `<Form>` (the type system rejects them) and a raw form POST to a streaming action returns 405.

- [ ] **Step 4: Build the docs site to verify the MDX still compiles**

Run: `pnpm -w --filter site build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/docs/
git commit -m "docs(site): describe page-URL actions, useActionResult, useFormStatus"
```

---

## Task 16: Final whole-repo verification

- [ ] **Step 1: Run all tests**

Run: `pnpm -w test -- --run`
Expected: all green across iso, server, vite, and any other workspace package.

- [ ] **Step 2: Run typecheck across the workspace**

Run: `pnpm -w typecheck` (or `pnpm -w -r tsc --noEmit` if no script).
Expected: 0 errors.

- [ ] **Step 3: Build the site**

Run: `pnpm -w --filter site build`
Expected: success.

- [ ] **Step 4: Confirm no dangling references**

Run: `grep -rn "/__actions\|actionsHandler" packages apps --include="*.ts" --include="*.tsx"`
Expected: no results.

- [ ] **Step 5: Final commit if anything trivial caught**

Only if Step 1–4 surfaced incidental cleanups. Otherwise nothing to do.

---

## Self-review notes

Spec coverage verified per section:

- **Goal** → Tasks 5–11 (whole new request path).
- **Wire shape (URL, content negotiation, envelope reshape)** → Tasks 2, 5, 8, 11.
- **Body parsing** → Task 5 (handler) and Task 8 (client).
- **PE response rules** → Task 5 (handler returns).
- **`<Form action={stub}>`** → Task 10.
- **`useActionResult` (with submittedPayload)** → Task 6 and Task 5 (slot population in handler).
- **`useFormStatus`** → Task 7; wired in Task 8 (useAction) and Task 10 (Form).
- **`useAction` URL/envelope change** → Task 8.
- **`useOptimisticAction` reshape (stub-shape + brand)** → Task 9; consumed in Task 10 (Form).
- **`deny()` signature** → Task 1.
- **Streaming actions on PE (405)** → Task 5 (handler) + Task 10 (type-level rejection via `TChunk = never`).
- **Migration / hard cutover** → Tasks 8, 11, 13, 14 sequenced so demo migrates before the legacy delete.
- **Testing approach** → Tasks 5 (unit), 12 (integration), 10 (bundle-content via hidden-input assertion).
- **Docs updates** → Task 15.
- **Open items deferred to plan (ActionResultContext placement, store shape, routeServerModules extension, handler naming)** → resolved in Tasks 6, 7, 4, 5 respectively.
