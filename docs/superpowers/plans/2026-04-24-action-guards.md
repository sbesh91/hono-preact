# Action Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add middleware-style guards that run before a server action executes, enabling auth checks, rate limiting, or any cross-cutting concern that should halt execution with an error response.

**Architecture:** A `.server.ts` file exports `actionGuards: ActionGuardFn[]` alongside `serverActions`. `actionsHandler` loads both per module and runs the guard chain before dispatching to the action function. Guards throw `ActionGuardError` to reject (returns 4xx), or call `next()` to continue. The Vite `serverOnlyPlugin` stubs `actionGuards` as `[]` in the client bundle.

**Tech Stack:** TypeScript, `@hono-preact/iso`, `@hono-preact/server`, `@hono-preact/vite`, vitest

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `packages/iso/src/action.ts` | **Modify** | Add `ActionGuardContext`, `ActionGuardFn`, `ActionGuardError`, `defineActionGuard` |
| `packages/iso/src/index.ts` | **Modify** | Export new guard types |
| `packages/server/src/actions-handler.ts` | **Modify** | Load `actionGuards` per module; run guard chain before action |
| `packages/vite/src/server-only.ts` | **Modify** | Stub `actionGuards` import as `[]` |
| `packages/server/src/__tests__/actions-handler.test.ts` | **Modify** | Add guard tests |
| `packages/vite/src/__tests__/server-only-plugin.test.ts` | **Modify** | Add `actionGuards` stub test |

---

### Task 1: Guard types and `defineActionGuard` in `action.ts`

**Files:**
- Modify: `packages/iso/src/action.ts`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Add types and helpers to `action.ts`**

Append to `packages/iso/src/action.ts`:

```ts
export type ActionGuardContext = {
  c: unknown;
  module: string;
  action: string;
  payload: unknown;
};

export type ActionGuardFn = (
  ctx: ActionGuardContext,
  next: () => Promise<void>
) => Promise<void>;

export class ActionGuardError extends Error {
  constructor(
    message: string,
    public readonly status: number = 403
  ) {
    super(message);
    this.name = 'ActionGuardError';
  }
}

export const defineActionGuard = (fn: ActionGuardFn): ActionGuardFn => fn;
```

- [ ] **Step 2: Export from `index.ts`**

Add to `packages/iso/src/index.ts`:

```ts
export type { ActionGuardContext, ActionGuardFn } from './action.js';
export { ActionGuardError, defineActionGuard } from './action.js';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @hono-preact/iso build
```

Expected: exit 0, no type errors

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/index.ts
git commit -m "feat(iso): add ActionGuardFn, ActionGuardError, and defineActionGuard"
```

---

### Task 2: Guard execution in `actionsHandler`

**Files:**
- Modify: `packages/server/src/actions-handler.ts`
- Modify: `packages/server/src/__tests__/actions-handler.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/__tests__/actions-handler.test.ts`:

```ts
import { ActionGuardError } from '@hono-preact/iso';

describe('actionsHandler — action guards', () => {
  it('runs guards before the action and allows through when next() is called', async () => {
    const guardFn = vi.fn().mockImplementation(async (_ctx, next) => next());
    const createFn = vi.fn().mockResolvedValue({ id: 1 });
    const app = makeApp({
      './pages/movies.server.ts': {
        serverActions: { create: createFn },
        actionGuards: [guardFn],
      },
    });

    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(200);
    expect(guardFn).toHaveBeenCalledOnce();
    expect(createFn).toHaveBeenCalledOnce();
  });

  it('returns 403 when a guard throws ActionGuardError', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        serverActions: { create: vi.fn() },
        actionGuards: [
          async () => {
            throw new ActionGuardError('Not allowed');
          },
        ],
      },
    });

    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe('Not allowed');
  });

  it('uses the status from ActionGuardError', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        serverActions: { create: vi.fn() },
        actionGuards: [
          async () => {
            throw new ActionGuardError('Unauthorized', 401);
          },
        ],
      },
    });

    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(401);
  });

  it('stops the chain when a guard does not call next()', async () => {
    const secondGuard = vi.fn();
    const createFn = vi.fn();
    const app = makeApp({
      './pages/movies.server.ts': {
        serverActions: { create: createFn },
        actionGuards: [
          async () => { throw new ActionGuardError('Blocked'); },
          secondGuard,
        ],
      },
    });

    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(403);
    expect(secondGuard).not.toHaveBeenCalled();
    expect(createFn).not.toHaveBeenCalled();
  });

  it('passes module, action, and payload to the guard context', async () => {
    const guardFn = vi.fn().mockImplementation(async (_ctx, next) => next());
    const app = makeApp({
      './pages/movies.server.ts': {
        serverActions: { create: vi.fn().mockResolvedValue({}) },
        actionGuards: [guardFn],
      },
    });

    await post(app, { module: 'movies', action: 'create', payload: { title: 'Dune' } });
    const [ctx] = guardFn.mock.calls[0];
    expect(ctx.module).toBe('movies');
    expect(ctx.action).toBe('create');
    expect(ctx.payload).toEqual({ title: 'Dune' });
  });

  it('works for modules without actionGuards', async () => {
    const createFn = vi.fn().mockResolvedValue({ id: 1 });
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { create: createFn } },
    });

    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(200);
    expect(createFn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
vitest run packages/server/src/__tests__/actions-handler.test.ts
```

Expected: FAIL — `actionGuards` not yet loaded or run

- [ ] **Step 3: Update `actionsHandler` to load and run guards**

> **Note:** If `2026-04-24-file-upload-actions.md` has already been implemented, the `packages/server/src/actions-handler.ts` file will have a multipart/form-data request-parsing branch. When applying the changes below, preserve that branch — the guard chain should run after request parsing for both JSON and multipart paths.

Replace `packages/server/src/actions-handler.ts` entirely (if file-upload plan is already applied, merge the multipart branch back in after the `module`/`action`/`payload` extraction):

```ts
import type { MiddlewareHandler } from 'hono';
import type { ActionGuardFn, ActionGuardContext } from '@hono-preact/iso';
import { ActionGuardError } from '@hono-preact/iso';

type GlobModule = {
  serverActions?: Record<string, unknown>;
  actionGuards?: ActionGuardFn[];
  [key: string]: unknown;
};
type LazyGlob = Record<string, () => Promise<GlobModule>>;
type EagerGlob = Record<string, GlobModule>;

type ModuleEntry = {
  actions: Record<string, unknown>;
  guards: ActionGuardFn[];
};

function moduleNameFromPath(filePath: string): string {
  return filePath
    .split('/')
    .pop()!
    .replace(/\.server\.[jt]sx?$/, '');
}

async function runActionGuards(
  guards: ActionGuardFn[],
  ctx: ActionGuardContext
): Promise<void> {
  const run = async (index: number): Promise<void> => {
    if (index >= guards.length) return;
    await guards[index](ctx, () => run(index + 1));
  };
  await run(0);
}

async function buildActionsMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, ModuleEntry>> {
  const result: Record<string, ModuleEntry> = {};
  for (const [filePath, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    if (mod.serverActions) {
      result[moduleNameFromPath(filePath)] = {
        actions: mod.serverActions as Record<string, unknown>,
        guards: (mod.actionGuards ?? []) as ActionGuardFn[],
      };
    }
  }
  return result;
}

export function actionsHandler(glob: LazyGlob | EagerGlob): MiddlewareHandler {
  let actionsMapPromise: Promise<Record<string, ModuleEntry>> | null = null;

  return async (c) => {
    if (!actionsMapPromise) {
      actionsMapPromise = buildActionsMap(glob).catch((err) => {
        actionsMapPromise = null;
        return Promise.reject(err);
      });
    }

    let actionsMap: Record<string, ModuleEntry>;
    try {
      actionsMap = await actionsMapPromise;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to load actions: ${message}` }, 503);
    }

    let body: { module: unknown; action: unknown; payload: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { module, action, payload } = body;
    if (typeof module !== 'string' || typeof action !== 'string') {
      return c.json({ error: 'Request body must include string fields: module, action' }, 400);
    }

    const entry = actionsMap[module];
    if (!entry) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    try {
      await runActionGuards(entry.guards, { c, module, action, payload });
    } catch (err) {
      if (err instanceof ActionGuardError) {
        return c.json({ error: err.message }, err.status as 400 | 401 | 403 | 404 | 429 | 500);
      }
      throw err;
    }

    const fn = entry.actions[action];
    if (typeof fn !== 'function') {
      return c.json({ error: `Action '${action}' not found in module '${module}'` }, 404);
    }

    try {
      const result = await (fn as (ctx: unknown, payload: unknown) => Promise<unknown>)(
        c,
        payload
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
vitest run packages/server/src/__tests__/actions-handler.test.ts
```

Expected: PASS (all existing + 6 new guard tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/actions-handler.ts packages/server/src/__tests__/actions-handler.test.ts
git commit -m "feat(server): actionsHandler runs actionGuards before dispatching to action"
```

---

### Task 3: Stub `actionGuards` in the Vite server-only plugin

**Files:**
- Modify: `packages/vite/src/server-only.ts`
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/vite/src/__tests__/server-only-plugin.test.ts`:

```ts
it('replaces actionGuards named import with an empty array stub', () => {
  const code = `import { actionGuards } from './movies.server.js';`;
  const result = transform(code, 'movies.tsx');
  expect(result?.code).toContain('const actionGuards = [];');
});

it('handles actionGuards alongside serverActions in the same statement', () => {
  const code = `import { actionGuards, serverActions } from './movies.server.js';`;
  const result = transform(code, '/src/pages/movies.tsx');
  expect(result?.code).toContain('const actionGuards = [];');
  expect(result?.code).toContain('const serverActions = new Proxy(');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
vitest run packages/vite/src/__tests__/server-only-plugin.test.ts
```

Expected: FAIL — `actionGuards` is not stubbed (returns undefined or is left as-is)

- [ ] **Step 3: Add `actionGuards` to the stub logic**

In `packages/vite/src/server-only.ts`, locate the `isServerImport` filter which checks for `serverGuards` and `serverActions`. Update it to also include `actionGuards`:

```ts
const isServerImport = (node: unknown): node is ImportDeclaration =>
  (node as ImportDeclaration).type === 'ImportDeclaration' &&
  /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value) &&
  (node as ImportDeclaration).specifiers.some(
    (s) =>
      s.type === 'ImportDefaultSpecifier' ||
      (s.type === 'ImportSpecifier' &&
        s.imported.type === 'Identifier' &&
        (s.imported.name === 'serverGuards' ||
          s.imported.name === 'actionGuards' ||
          s.imported.name === 'serverActions'))
  );
```

Then in the stub generation loop, add `actionGuards` to the `serverGuards` branch:

```ts
} else if (
  specifier.type === 'ImportSpecifier' &&
  specifier.imported.type === 'Identifier' &&
  (specifier.imported.name === 'serverGuards' ||
    specifier.imported.name === 'actionGuards')
) {
  stubs.push(`const ${specifier.local.name} = [];`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
vitest run packages/vite/src/__tests__/server-only-plugin.test.ts
```

Expected: PASS (all existing + 2 new tests)

- [ ] **Step 5: Verify full test suite**

```bash
vitest run
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/server-only.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "feat(vite): stub actionGuards as [] in client build"
```

---

## Usage Example

```ts
// src/pages/movies.server.ts
import { defineAction, defineActionGuard, ActionGuardError } from '@hono-preact/iso';
import type { Context } from 'hono';

export const actionGuards = [
  defineActionGuard(async ({ c }, next) => {
    const token = (c as Context).req.header('Authorization');
    if (!token) throw new ActionGuardError('Authentication required', 401);
    return next();
  }),
];

export const serverActions = {
  create: defineAction<{ title: string }, { id: number }>(async (_ctx, payload) => {
    const movie = await insertMovie(payload);
    return { id: movie.id };
  }),
  delete: defineAction<{ id: number }, { ok: boolean }>(async (_ctx, { id }) => {
    await deleteMovie(id);
    return { ok: true };
  }),
};
```

All actions in the module run through `actionGuards` before executing. Guards have access to the Hono `Context` via `ctx.c` for reading headers, cookies, or any request data.
