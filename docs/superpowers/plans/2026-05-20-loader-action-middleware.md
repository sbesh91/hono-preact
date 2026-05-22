# Loader/Action/Page Middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the framework's three overlapping "wrap a call with policy" concepts (page guards, action guards, the gap #44 names) with one unified middleware primitive plus a stream-observer primitive, both registered through a single `use` array at three binding layers, with outcomes (`redirect`, `deny`, `render`) propagating uniformly across SSR-inline, RPC, and client-navigation transports.

**Architecture:** Two primitives (`defineServerMiddleware` / `defineClientMiddleware` and `defineStreamObserver`) and one outcome system (`redirect` / `deny` / `render`) live in `@hono-preact/iso`. A dispatcher (`internal/middleware-runner.ts` + `internal/stream-observer-runner.ts`) is invoked from the server-side handlers (`loaders-handler.ts`, `actions-handler.ts`, `render.tsx`) and the client-side `PageMiddlewareHost` (replaces `Guards`). Chains compose outer→inner: root (`defineApp`) → page (`definePage`) → per-unit (`defineLoader` / `defineAction`).

**Tech Stack:** TypeScript, Preact, Hono, preact-iso, Vite, Vitest. Monorepo via pnpm. Test command: `pnpm test`. Typecheck: `pnpm typecheck`. Format: `pnpm format`.

**Sequencing strategy:** Additive-then-subtractive. Phases 1–6 land all new primitives, types, and the dispatcher without removing legacy. Phase 7 wires the new path additively into `definePage` / `defineLoader` / `defineAction` and handlers. Phase 8 migrates application code, then deletes legacy in one cohesive pass. Phase 9 updates docs. This keeps tests green between commits.

**Reference spec:** `docs/superpowers/specs/2026-05-20-loader-action-middleware-design.md`.

---

## File-Structure Map

**New files in `@hono-preact/iso`:**

```
packages/iso/src/
  outcomes.ts                      RedirectOutcome / DenyOutcome / RenderOutcome types,
                                   redirect/deny constructors, predicates
  page-only.ts                     subpath barrel: render() (page-scope only)
  define-middleware.ts             defineServerMiddleware, defineClientMiddleware,
                                   context types, Scope, Next
  define-stream-observer.ts        defineStreamObserver, StreamObserver type, ServerStreamCtx
  define-app.ts                    defineApp, AppConfig
  internal/
    use-types.ts                   Use<S, Streaming, T, R> generator + AppUse/PageUse/LoaderUse/ActionUse
    use-partitioner.ts             splits a use[] into middleware + observers
    middleware-runner.ts           dispatcher: walks chain, translates thrown outcomes
    stream-observer-runner.ts      fans out lifecycle events with failure isolation
    page-middleware-host.tsx       replaces Guards; mounts client-side dispatch
```

**Modified files:**

```
packages/iso/src/
  define-loader.ts                 add `use` to opts (overload-gated by streaming-ness)
  action.ts                        rename to use opts bag; add `use`; remove ActionGuardError
  define-page.tsx                  replace `guards` with `use`
  page.tsx                         swap Guards for PageMiddlewareHost
  index.ts                         new exports, removed guard exports
  package.json                     add ./page subpath export

packages/iso/src/internal/
  guards.tsx                       DELETE (replaced by page-middleware-host.tsx)
  contexts.ts                      remove GuardResultContext; possibly add OutcomeContext

packages/iso/src/
  guard.ts                         DELETE (subsumed by define-middleware.ts)

packages/server/src/
  loaders-handler.ts               accept appConfig + route table; call dispatcher
  actions-handler.ts               accept appConfig + route table; call dispatcher;
                                   stop reading actionGuards module export
  render.tsx                       call dispatcher for page-render path

packages/vite/src/
  guard-strip.ts                   extend allowlist with new symbols; rename file?
                                   (stays guard-strip.ts; just broader scope)
  server-loaders-parser.ts         surface pageUse/loaderUse/actionUse exports

apps/site/src/
  demo/guard.ts                    rewrite as middleware
  pages/demo/*.server.ts           replace actionGuards with use
  pages/docs/guards.mdx            DELETE
  pages/docs/action-guards.mdx     DELETE
  pages/docs/middleware.mdx        NEW
  pages/docs/structure.mdx         update to show defineApp

apps/app/                          migrate any guard/actionGuard usage to middleware
```

---

## Conventions (read before starting)

- **Test files** live next to the source under `__tests__/`, e.g. `packages/iso/src/__tests__/outcomes.test.ts`. The repo's vitest config (`vitest.config.ts`) discovers these automatically.
- **Test single file:** `pnpm test packages/iso/src/__tests__/outcomes.test.ts`.
- **Run a single test by name:** `pnpm test -t "test name fragment"`.
- **Typecheck whole repo:** `pnpm typecheck`.
- **Format:** `pnpm format` writes; `pnpm format:check` only checks.
- **Imports inside `@hono-preact/iso`:** use `.js` suffix on relative imports (TypeScript NodeNext convention), e.g. `import { redirect } from './outcomes.js';`. The repo's `tsconfig.json` enforces this.
- **No back-compat shims.** When deleting a symbol, delete its callers in the same logical commit. Phases 1–6 do not delete anything; Phase 8 is where deletions happen.
- **No em-dashes** in prose, code comments, or commit messages (per `CLAUDE.md`).
- **Commit cadence:** one commit per task minimum. Larger tasks split commits per step where natural.
- **TDD:** every task starts with a failing test, then implementation. Run-the-test-to-see-it-fail steps are present and intentional; do not skip them.

---

## Task 1: Outcomes — types, constructors, predicates

**Files:**
- Create: `packages/iso/src/outcomes.ts`
- Create: `packages/iso/src/__tests__/outcomes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/outcomes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  redirect,
  deny,
  isOutcome,
  isRedirect,
  isDeny,
  isRender,
} from '../outcomes.js';

describe('redirect()', () => {
  it('accepts a string and produces a 302 outcome', () => {
    const o = redirect('/login');
    expect(o).toEqual({
      __outcome: 'redirect',
      to: '/login',
      status: 302,
      headers: undefined,
    });
  });

  it('accepts an object with status and headers', () => {
    const o = redirect({
      to: '/login',
      status: 307,
      headers: { 'X-Reason': 'auth' },
    });
    expect(o.status).toBe(307);
    expect(o.headers).toEqual({ 'X-Reason': 'auth' });
  });
});

describe('deny()', () => {
  it('accepts a positional status and message', () => {
    const o = deny(403, 'Forbidden');
    expect(o).toEqual({
      __outcome: 'deny',
      status: 403,
      message: 'Forbidden',
      headers: undefined,
    });
  });

  it('accepts an object form with headers', () => {
    const o = deny({ status: 429, message: 'Slow', headers: { 'Retry-After': '5' } });
    expect(o.status).toBe(429);
    expect(o.headers).toEqual({ 'Retry-After': '5' });
  });

  it('makes message optional', () => {
    const o = deny(401);
    expect(o.message).toBeUndefined();
  });
});

describe('predicates', () => {
  it('isOutcome matches redirect/deny/render shapes', () => {
    expect(isOutcome(redirect('/x'))).toBe(true);
    expect(isOutcome(deny(403))).toBe(true);
    expect(isOutcome({})).toBe(false);
    expect(isOutcome(null)).toBe(false);
    expect(isOutcome(new Error('x'))).toBe(false);
  });

  it('isRedirect / isDeny / isRender discriminate the variants', () => {
    expect(isRedirect(redirect('/x'))).toBe(true);
    expect(isRedirect(deny(403))).toBe(false);
    expect(isDeny(deny(403))).toBe(true);
    expect(isDeny(redirect('/x'))).toBe(false);
    expect(isRender({ __outcome: 'render', Component: () => null })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/iso/src/__tests__/outcomes.test.ts`
Expected: FAIL with "Cannot find module '../outcomes.js'".

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/outcomes.ts`:

```ts
import type { FunctionComponent } from 'preact';
import type {
  RedirectStatusCode,
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from 'hono/utils/http-status';

export type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;
export type { RedirectStatusCode };

export type RedirectOutcome = {
  __outcome: 'redirect';
  to: string;
  status: RedirectStatusCode;
  headers: Record<string, string> | undefined;
};

export type DenyOutcome = {
  __outcome: 'deny';
  status: ErrorStatusCode;
  message: string | undefined;
  headers: Record<string, string> | undefined;
};

export type RenderOutcome = {
  __outcome: 'render';
  Component: FunctionComponent;
};

export type Outcome = RedirectOutcome | DenyOutcome | RenderOutcome;

type RedirectInput =
  | string
  | {
      to: string;
      status?: RedirectStatusCode;
      headers?: Record<string, string>;
    };

export function redirect(input: RedirectInput): RedirectOutcome {
  if (typeof input === 'string') {
    return { __outcome: 'redirect', to: input, status: 302, headers: undefined };
  }
  return {
    __outcome: 'redirect',
    to: input.to,
    status: input.status ?? 302,
    headers: input.headers,
  };
}

type DenyInput =
  | {
      status: ErrorStatusCode;
      message?: string;
      headers?: Record<string, string>;
    };

export function deny(status: ErrorStatusCode, message?: string): DenyOutcome;
export function deny(spec: DenyInput): DenyOutcome;
export function deny(
  a: ErrorStatusCode | DenyInput,
  b?: string
): DenyOutcome {
  if (typeof a === 'object') {
    return {
      __outcome: 'deny',
      status: a.status,
      message: a.message,
      headers: a.headers,
    };
  }
  return {
    __outcome: 'deny',
    status: a,
    message: b,
    headers: undefined,
  };
}

export function isOutcome(value: unknown): value is Outcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__outcome' in value &&
    (value as { __outcome: unknown }).__outcome !== undefined
  );
}

export function isRedirect(value: unknown): value is RedirectOutcome {
  return isOutcome(value) && value.__outcome === 'redirect';
}

export function isDeny(value: unknown): value is DenyOutcome {
  return isOutcome(value) && value.__outcome === 'deny';
}

export function isRender(value: unknown): value is RenderOutcome {
  return isOutcome(value) && value.__outcome === 'render';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/iso/src/__tests__/outcomes.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/outcomes.ts packages/iso/src/__tests__/outcomes.test.ts
git commit -m "feat(iso): add outcome types, constructors, predicates"
```

---

## Task 2: render() at the page subpath

**Files:**
- Create: `packages/iso/src/page-only.ts`
- Create: `packages/iso/src/__tests__/page-only.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/page-only.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { render, isRender } from '../page-only.js';

describe('render() (page-scope subpath)', () => {
  it('constructs a render outcome with the given component', () => {
    const C = () => null;
    const o = render(C);
    expect(o).toEqual({ __outcome: 'render', Component: C });
  });

  it('result is recognized by isRender', () => {
    expect(isRender(render(() => null))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm test packages/iso/src/__tests__/page-only.test.ts`
Expected: FAIL with "Cannot find module '../page-only.js'".

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/page-only.ts`:

```ts
import type { FunctionComponent } from 'preact';
import type { RenderOutcome } from './outcomes.js';

export { isRender } from './outcomes.js';

export function render(Component: FunctionComponent): RenderOutcome {
  return { __outcome: 'render', Component };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm test packages/iso/src/__tests__/page-only.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/page-only.ts packages/iso/src/__tests__/page-only.test.ts
git commit -m "feat(iso): add render() outcome at page-only subpath"
```

---

## Task 3: Expose page-only subpath via package.json + vitest alias

**Files:**
- Modify: `packages/iso/package.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the subpath to package exports**

Edit `packages/iso/package.json` to add a third entry under `exports`:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./internal": {
    "types": "./dist/internal.d.ts",
    "import": "./dist/internal.js"
  },
  "./page": {
    "types": "./dist/page-only.d.ts",
    "import": "./dist/page-only.js"
  }
}
```

- [ ] **Step 2: Add the alias to vitest.config.ts**

Add to the `resolve.alias` block in `vitest.config.ts` (between the `/internal` and `.` entries):

```ts
'@hono-preact/iso/page': path.resolve(__dirname, 'packages/iso/src/page-only.ts'),
```

- [ ] **Step 3: Add a sanity test that the subpath import resolves**

Create `packages/iso/src/__tests__/page-only-subpath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { render } from '@hono-preact/iso/page';
import { isRender } from '@hono-preact/iso';

describe('@hono-preact/iso/page subpath', () => {
  it('exports render() resolvable through the subpath', () => {
    const o = render(() => null);
    expect(isRender(o)).toBe(true);
  });
});
```

- [ ] **Step 4: Run the new test plus the existing exports test**

Run: `pnpm test packages/iso/src/__tests__/page-only-subpath.test.ts packages/hono-preact/__tests__/exports.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/package.json vitest.config.ts packages/iso/src/__tests__/page-only-subpath.test.ts
git commit -m "feat(iso): expose /page subpath for page-scope-only API"
```

---

## Task 4: Context types and Scope

**Files:**
- Create: `packages/iso/src/define-middleware.ts` (types only in this task)

- [ ] **Step 1: Write the implementation (types-only file, no runtime to test yet)**

Create `packages/iso/src/define-middleware.ts`:

```ts
import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import type { Outcome } from './outcomes.js';

export type Scope = 'page' | 'loader' | 'action';

export type ServerBaseCtx = {
  c: Context;
  signal: AbortSignal;
};

export type ServerPageCtx = ServerBaseCtx & {
  scope: 'page';
  location: RouteHook;
};

export type ServerLoaderCtx = ServerBaseCtx & {
  scope: 'loader';
  location: RouteHook;
  module: string;
  loader: string;
};

export type ServerActionCtx = ServerBaseCtx & {
  scope: 'action';
  module: string;
  action: string;
  payload: unknown;
};

export type ServerCtx<S extends Scope = Scope> = S extends 'page'
  ? ServerPageCtx
  : S extends 'loader'
    ? ServerLoaderCtx
    : S extends 'action'
      ? ServerActionCtx
      : ServerPageCtx | ServerLoaderCtx | ServerActionCtx;

export type ClientPageCtx = {
  scope: 'page';
  location: RouteHook;
};

export type Next = () => Promise<unknown>;

export type ServerMiddleware<S extends Scope = Scope> = {
  __kind: 'middleware';
  runs: 'server';
  fn: (ctx: ServerCtx<S>, next: Next) => Promise<void | Outcome>;
};

export type ClientMiddleware = {
  __kind: 'middleware';
  runs: 'client';
  fn: (ctx: ClientPageCtx, next: Next) => Promise<void | Outcome>;
};

export type Middleware = ServerMiddleware | ClientMiddleware;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/define-middleware.ts
git commit -m "feat(iso): add middleware context types and Scope"
```

---

## Task 5: defineServerMiddleware + defineClientMiddleware

**Files:**
- Modify: `packages/iso/src/define-middleware.ts` (add constructors)
- Create: `packages/iso/src/__tests__/define-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/define-middleware.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  defineServerMiddleware,
  defineClientMiddleware,
} from '../define-middleware.js';

describe('defineServerMiddleware', () => {
  it('produces a record branded with kind, runs, and fn', () => {
    const mw = defineServerMiddleware(async (_ctx, next) => {
      await next();
    });
    expect(mw.__kind).toBe('middleware');
    expect(mw.runs).toBe('server');
    expect(typeof mw.fn).toBe('function');
  });
});

describe('defineClientMiddleware', () => {
  it('produces a record branded with kind, runs, and fn', () => {
    const mw = defineClientMiddleware(async (_ctx, next) => {
      await next();
    });
    expect(mw.__kind).toBe('middleware');
    expect(mw.runs).toBe('client');
  });

  it('its context has no `c` field at the type level (smoke check at runtime)', async () => {
    let observedKeys: string[] = [];
    const mw = defineClientMiddleware(async (ctx, next) => {
      observedKeys = Object.keys(ctx);
      await next();
    });
    await mw.fn(
      { scope: 'page', location: { path: '/' } as never },
      async () => undefined
    );
    expect(observedKeys).toContain('location');
    expect(observedKeys).not.toContain('c');
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/__tests__/define-middleware.test.ts`
Expected: FAIL ("defineServerMiddleware is not a function" or similar).

- [ ] **Step 3: Append constructors to `define-middleware.ts`**

Append to `packages/iso/src/define-middleware.ts`:

```ts
export function defineServerMiddleware<S extends Scope = Scope>(
  fn: ServerMiddleware<S>['fn']
): ServerMiddleware<S> {
  return { __kind: 'middleware', runs: 'server', fn };
}

export function defineClientMiddleware(
  fn: ClientMiddleware['fn']
): ClientMiddleware {
  return { __kind: 'middleware', runs: 'client', fn };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/iso/src/__tests__/define-middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-middleware.ts packages/iso/src/__tests__/define-middleware.test.ts
git commit -m "feat(iso): add defineServerMiddleware and defineClientMiddleware"
```

---

## Task 6: defineStreamObserver

**Files:**
- Create: `packages/iso/src/define-stream-observer.ts`
- Create: `packages/iso/src/__tests__/define-stream-observer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/define-stream-observer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineStreamObserver } from '../define-stream-observer.js';

describe('defineStreamObserver', () => {
  it('produces a record branded with kind and the provided hooks', () => {
    const o = defineStreamObserver({
      onStart: () => {},
      onChunk: () => {},
    });
    expect(o.__kind).toBe('observer');
    expect(typeof o.onStart).toBe('function');
    expect(typeof o.onChunk).toBe('function');
  });

  it('omitted hooks remain undefined', () => {
    const o = defineStreamObserver({ onChunk: () => {} });
    expect(o.onStart).toBeUndefined();
    expect(o.onEnd).toBeUndefined();
    expect(o.onError).toBeUndefined();
    expect(o.onAbort).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/__tests__/define-stream-observer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/define-stream-observer.ts`:

```ts
import type { ServerLoaderCtx, ServerActionCtx } from './define-middleware.js';

export type ServerStreamCtx = ServerLoaderCtx | ServerActionCtx;

export type StreamObserver<TChunk = unknown, TResult = void> = {
  __kind: 'observer';
  onStart?: (ctx: ServerStreamCtx) => void;
  onChunk?: (ctx: ServerStreamCtx, chunk: TChunk, index: number) => void;
  onEnd?: (
    ctx: ServerStreamCtx,
    info: { chunks: number; result: TResult }
  ) => void;
  onError?: (
    ctx: ServerStreamCtx,
    err: unknown,
    info: { chunks: number }
  ) => void;
  onAbort?: (ctx: ServerStreamCtx, info: { chunks: number }) => void;
};

type Spec<TChunk, TResult> = Omit<StreamObserver<TChunk, TResult>, '__kind'>;

export function defineStreamObserver<TChunk = unknown, TResult = void>(
  spec: Spec<TChunk, TResult>
): StreamObserver<TChunk, TResult> {
  return { __kind: 'observer', ...spec };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/iso/src/__tests__/define-stream-observer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-stream-observer.ts packages/iso/src/__tests__/define-stream-observer.test.ts
git commit -m "feat(iso): add defineStreamObserver primitive"
```

---

## Task 7: defineApp + AppConfig

**Files:**
- Create: `packages/iso/src/define-app.ts`
- Create: `packages/iso/src/__tests__/define-app.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/define-app.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineApp } from '../define-app.js';
import { defineServerMiddleware } from '../define-middleware.js';
import { defineStreamObserver } from '../define-stream-observer.js';

describe('defineApp', () => {
  it('returns the config unchanged (identity function with type narrowing)', () => {
    const cfg = defineApp({ use: [] });
    expect(cfg.use).toEqual([]);
  });

  it('accepts middleware and observers in the use array', () => {
    const mw = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const obs = defineStreamObserver({ onStart: () => {} });
    const cfg = defineApp({ use: [mw, obs] });
    expect(cfg.use).toHaveLength(2);
  });

  it('use is optional', () => {
    const cfg = defineApp({});
    expect(cfg.use).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/__tests__/define-app.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/define-app.ts`:

```ts
import type {
  ServerMiddleware,
  ClientMiddleware,
  Scope,
} from './define-middleware.js';
import type { StreamObserver } from './define-stream-observer.js';

export type AppUseElement =
  | ServerMiddleware<Scope>
  | ClientMiddleware
  | StreamObserver<unknown, unknown>;

export type AppConfig = {
  use?: ReadonlyArray<AppUseElement>;
};

export function defineApp(config: AppConfig): AppConfig {
  return config;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/iso/src/__tests__/define-app.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-app.ts packages/iso/src/__tests__/define-app.test.ts
git commit -m "feat(iso): add defineApp + AppConfig"
```

---

## Task 8: Use type generator + layered binding types

**Files:**
- Create: `packages/iso/src/internal/use-types.ts`

- [ ] **Step 1: Write the implementation (types-only)**

Create `packages/iso/src/internal/use-types.ts`:

```ts
import type {
  ServerMiddleware,
  ClientMiddleware,
  Scope,
} from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';

export type Use<
  S extends Scope,
  Streaming extends boolean,
  T = unknown,
  R = void,
> = ReadonlyArray<
  | ServerMiddleware<S>
  | (S extends 'page' ? ClientMiddleware : never)
  | (Streaming extends true ? StreamObserver<T, R> : never)
>;

export type AppUse = Use<Scope, true>;
export type PageUse = Use<Scope, true>;
export type LoaderUse<T, Streaming extends boolean> = Use<
  'loader',
  Streaming,
  T,
  void
>;
export type ActionUse<
  TChunk,
  TResult,
  Streaming extends boolean,
> = Use<'action', Streaming, TChunk, TResult>;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/internal/use-types.ts
git commit -m "feat(iso): add Use<S, Streaming, T, R> generator and layered binding types"
```

---

## Task 9: use-partitioner

**Files:**
- Create: `packages/iso/src/internal/use-partitioner.ts`
- Create: `packages/iso/src/internal/__tests__/use-partitioner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/use-partitioner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { partitionUse } from '../use-partitioner.js';
import { defineServerMiddleware } from '../../define-middleware.js';
import { defineStreamObserver } from '../../define-stream-observer.js';

describe('partitionUse', () => {
  it('returns empty arrays for an empty input', () => {
    const { middleware, observers } = partitionUse([]);
    expect(middleware).toEqual([]);
    expect(observers).toEqual([]);
  });

  it('splits middleware from observers, preserving relative order within each kind', () => {
    const mw1 = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const obs1 = defineStreamObserver({ onStart: () => {} });
    const mw2 = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const obs2 = defineStreamObserver({ onEnd: () => {} });

    const { middleware, observers } = partitionUse([mw1, obs1, mw2, obs2]);
    expect(middleware).toEqual([mw1, mw2]);
    expect(observers).toEqual([obs1, obs2]);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/internal/__tests__/use-partitioner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/internal/use-partitioner.ts`:

```ts
import type { Middleware } from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';

type UseEntry = Middleware | StreamObserver<unknown, unknown>;

export function partitionUse(
  use: ReadonlyArray<UseEntry>
): { middleware: Middleware[]; observers: StreamObserver<unknown, unknown>[] } {
  const middleware: Middleware[] = [];
  const observers: StreamObserver<unknown, unknown>[] = [];
  for (const entry of use) {
    if (entry.__kind === 'middleware') middleware.push(entry);
    else observers.push(entry);
  }
  return { middleware, observers };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/iso/src/internal/__tests__/use-partitioner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/use-partitioner.ts packages/iso/src/internal/__tests__/use-partitioner.test.ts
git commit -m "feat(iso): add use-partitioner to split middleware from observers"
```

---

## Task 10: middleware-runner — basic chain walk

**Files:**
- Create: `packages/iso/src/internal/middleware-runner.ts`
- Create: `packages/iso/src/internal/__tests__/middleware-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/middleware-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import { defineServerMiddleware } from '../../define-middleware.js';
import { dispatchServer, type DispatchResult } from '../middleware-runner.js';

const fakeC = { req: { header: () => undefined } } as unknown as Context;
const signal = new AbortController().signal;

describe('dispatchServer — basic chain', () => {
  it('runs middleware in array order around the inner function', async () => {
    const calls: string[] = [];
    const a = defineServerMiddleware(async (_ctx, next) => {
      calls.push('a:before');
      await next();
      calls.push('a:after');
    });
    const b = defineServerMiddleware(async (_ctx, next) => {
      calls.push('b:before');
      await next();
      calls.push('b:after');
    });

    const result: DispatchResult<string> = await dispatchServer({
      middleware: [a, b],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => 'inner-value',
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toBe('inner-value');
    expect(calls).toEqual(['a:before', 'b:before', 'b:after', 'a:after']);
  });

  it('returns inner result when no middleware is attached', async () => {
    const result = await dispatchServer({
      middleware: [],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => 42,
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toBe(42);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/internal/__tests__/middleware-runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/internal/middleware-runner.ts`:

```ts
import type {
  ServerMiddleware,
  ClientMiddleware,
  ServerCtx,
  ClientPageCtx,
  Next,
  Scope,
} from '../define-middleware.js';
import { isOutcome, type Outcome } from '../outcomes.js';

export type DispatchResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'outcome'; outcome: Outcome };

type ServerDispatchArgs<T, S extends Scope> = {
  middleware: ReadonlyArray<ServerMiddleware<S>>;
  ctx: ServerCtx<S>;
  inner: () => Promise<T>;
};

export async function dispatchServer<T, S extends Scope = Scope>(
  args: ServerDispatchArgs<T, S>
): Promise<DispatchResult<T>> {
  let innerResult: T | undefined;
  let ran = false;

  const runChain = async (index: number): Promise<void> => {
    if (index >= args.middleware.length) {
      innerResult = await args.inner();
      ran = true;
      return;
    }
    const mw = args.middleware[index];
    let nextCalled = false;
    const next: Next = async () => {
      nextCalled = true;
      await runChain(index + 1);
      return innerResult;
    };
    const ret = await mw.fn(args.ctx, next);
    if (isOutcome(ret)) {
      throw ret;
    }
    if (!nextCalled) {
      throw new Error(
        `Middleware at index ${index} returned without calling next() or short-circuiting via a thrown outcome. ` +
          `Middleware must either: (a) await/return next() to pass control on, or (b) throw a redirect/deny/render outcome to short-circuit. ` +
          `Returning silently is ambiguous and would let downstream code run.`
      );
    }
  };

  try {
    await runChain(0);
  } catch (thrown) {
    if (isOutcome(thrown)) {
      return { kind: 'outcome', outcome: thrown };
    }
    throw thrown;
  }

  return { kind: 'ok', value: innerResult as T };
}

type ClientDispatchArgs<T> = {
  middleware: ReadonlyArray<ClientMiddleware>;
  ctx: ClientPageCtx;
  inner: () => Promise<T>;
};

export async function dispatchClient<T>(
  args: ClientDispatchArgs<T>
): Promise<DispatchResult<T>> {
  let innerResult: T | undefined;

  const runChain = async (index: number): Promise<void> => {
    if (index >= args.middleware.length) {
      innerResult = await args.inner();
      return;
    }
    const mw = args.middleware[index];
    let nextCalled = false;
    const next: Next = async () => {
      nextCalled = true;
      await runChain(index + 1);
      return innerResult;
    };
    const ret = await mw.fn(args.ctx, next);
    if (isOutcome(ret)) throw ret;
    if (!nextCalled) {
      throw new Error(
        `Middleware at index ${index} returned without calling next() or short-circuiting via a thrown outcome.`
      );
    }
  };

  try {
    await runChain(0);
  } catch (thrown) {
    if (isOutcome(thrown)) return { kind: 'outcome', outcome: thrown };
    throw thrown;
  }

  return { kind: 'ok', value: innerResult as T };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/iso/src/internal/__tests__/middleware-runner.test.ts`
Expected: PASS (both tests in this task; subsequent tasks add more).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/middleware-runner.ts packages/iso/src/internal/__tests__/middleware-runner.test.ts
git commit -m "feat(iso): add middleware-runner chain dispatcher (server and client)"
```

---

## Task 11: middleware-runner — forgotten-next() + outcome propagation tests

**Files:**
- Modify: `packages/iso/src/internal/__tests__/middleware-runner.test.ts`

- [ ] **Step 1: Append additional tests**

Append to `packages/iso/src/internal/__tests__/middleware-runner.test.ts`:

```ts
import { redirect, deny, isOutcome } from '../../outcomes.js';

describe('dispatchServer — outcomes', () => {
  it('catches a thrown redirect and returns it as outcome result', async () => {
    const mw = defineServerMiddleware(async () => {
      throw redirect('/login');
    });
    const result = await dispatchServer({
      middleware: [mw],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => 'unreached',
    });
    expect(result.kind).toBe('outcome');
    if (result.kind === 'outcome') {
      expect(result.outcome.__outcome).toBe('redirect');
    }
  });

  it('catches a thrown deny from the inner function', async () => {
    const result = await dispatchServer({
      middleware: [],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => {
        throw deny(403, 'No');
      },
    });
    expect(result.kind).toBe('outcome');
    if (result.kind === 'outcome') {
      expect(result.outcome.__outcome).toBe('deny');
    }
  });

  it('rethrows non-outcome errors', async () => {
    const mw = defineServerMiddleware(async () => {
      throw new Error('boom');
    });
    await expect(
      dispatchServer({
        middleware: [mw],
        ctx: {
          scope: 'loader',
          c: fakeC,
          signal,
          location: { path: '/' } as never,
          module: 'm',
          loader: 'l',
        },
        inner: async () => 'x',
      })
    ).rejects.toThrow('boom');
  });

  it('detects forgotten-next() and throws a structured error', async () => {
    const bad = defineServerMiddleware(async () => {
      // returns without calling next() and without throwing an outcome
    });
    await expect(
      dispatchServer({
        middleware: [bad],
        ctx: {
          scope: 'loader',
          c: fakeC,
          signal,
          location: { path: '/' } as never,
          module: 'm',
          loader: 'l',
        },
        inner: async () => 'x',
      })
    ).rejects.toThrow(/next\(\) or short-circuiting/);
  });

  it('outer middleware can catch an inner outcome and re-emit a different one', async () => {
    const outer = defineServerMiddleware(async (_ctx, next) => {
      try {
        await next();
      } catch (e) {
        if (isOutcome(e) && e.__outcome === 'deny') {
          throw redirect('/login');
        }
        throw e;
      }
    });
    const inner = defineServerMiddleware(async () => {
      throw deny(403);
    });

    const result = await dispatchServer({
      middleware: [outer, inner],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => 'unreached',
    });

    expect(result.kind).toBe('outcome');
    if (result.kind === 'outcome') {
      expect(result.outcome.__outcome).toBe('redirect');
    }
  });
});
```

- [ ] **Step 2: Run, verify all pass**

Run: `pnpm test packages/iso/src/internal/__tests__/middleware-runner.test.ts`
Expected: PASS (all tests added so far).

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/internal/__tests__/middleware-runner.test.ts
git commit -m "test(iso): cover middleware-runner forgotten-next, outcomes, re-emit composition"
```

---

## Task 12: stream-observer-runner

**Files:**
- Create: `packages/iso/src/internal/stream-observer-runner.ts`
- Create: `packages/iso/src/internal/__tests__/stream-observer-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/stream-observer-runner.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'hono';
import {
  fanStart,
  fanChunk,
  fanEnd,
  fanError,
  fanAbort,
} from '../stream-observer-runner.js';
import { defineStreamObserver } from '../../define-stream-observer.js';
import type { ServerLoaderCtx } from '../../define-middleware.js';

const fakeC = {} as Context;
const fakeCtx: ServerLoaderCtx = {
  scope: 'loader',
  c: fakeC,
  signal: new AbortController().signal,
  location: { path: '/' } as never,
  module: 'm',
  loader: 'l',
};

describe('stream-observer-runner — lifecycle fanout', () => {
  it('fanStart calls onStart on every observer with the ctx', () => {
    const onStartA = vi.fn();
    const onStartB = vi.fn();
    const obsA = defineStreamObserver({ onStart: onStartA });
    const obsB = defineStreamObserver({ onStart: onStartB });

    fanStart([obsA, obsB], fakeCtx);

    expect(onStartA).toHaveBeenCalledWith(fakeCtx);
    expect(onStartB).toHaveBeenCalledWith(fakeCtx);
  });

  it('fanChunk passes chunk and index to each onChunk', () => {
    const onChunk = vi.fn();
    const obs = defineStreamObserver({ onChunk });
    fanChunk([obs], fakeCtx, 'chunk-0', 0);
    fanChunk([obs], fakeCtx, 'chunk-1', 1);
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, fakeCtx, 'chunk-0', 0);
    expect(onChunk).toHaveBeenNthCalledWith(2, fakeCtx, 'chunk-1', 1);
  });

  it('fanEnd, fanError, fanAbort fire their respective hooks', () => {
    const onEnd = vi.fn();
    const onError = vi.fn();
    const onAbort = vi.fn();
    const obs = defineStreamObserver({ onEnd, onError, onAbort });

    fanEnd([obs], fakeCtx, { chunks: 3, result: undefined });
    fanError([obs], fakeCtx, new Error('boom'), { chunks: 1 });
    fanAbort([obs], fakeCtx, { chunks: 2 });

    expect(onEnd).toHaveBeenCalledWith(fakeCtx, { chunks: 3, result: undefined });
    expect(onError).toHaveBeenCalledWith(fakeCtx, expect.any(Error), { chunks: 1 });
    expect(onAbort).toHaveBeenCalledWith(fakeCtx, { chunks: 2 });
  });
});

describe('stream-observer-runner — failure isolation', () => {
  it('an observer that throws does not prevent subsequent observers from being called', () => {
    const onChunkA = vi.fn(() => {
      throw new Error('a-broke');
    });
    const onChunkB = vi.fn();
    const obsA = defineStreamObserver({ onChunk: onChunkA });
    const obsB = defineStreamObserver({ onChunk: onChunkB });

    fanChunk([obsA, obsB], fakeCtx, 'x', 0);

    expect(onChunkA).toHaveBeenCalled();
    expect(onChunkB).toHaveBeenCalledWith(fakeCtx, 'x', 0);
  });

  it('observer errors are swallowed, not rethrown to the caller', () => {
    const obs = defineStreamObserver({
      onStart: () => {
        throw new Error('observer-broke');
      },
    });
    expect(() => fanStart([obs], fakeCtx)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/internal/__tests__/stream-observer-runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/internal/stream-observer-runner.ts`:

```ts
import type { StreamObserver, ServerStreamCtx } from '../define-stream-observer.js';

function safeCall(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch (err) {
    // Observer errors are isolated: surface via console for visibility but do
    // not propagate. The stream is the source of truth; observers are a side
    // channel and cannot corrupt the channel they observe.
    // eslint-disable-next-line no-console
    console.error('[stream-observer] hook threw and was isolated:', err);
  }
}

export function fanStart(
  observers: ReadonlyArray<StreamObserver<unknown, unknown>>,
  ctx: ServerStreamCtx
): void {
  for (const o of observers) {
    safeCall(o.onStart ? () => o.onStart!(ctx) : undefined);
  }
}

export function fanChunk(
  observers: ReadonlyArray<StreamObserver<unknown, unknown>>,
  ctx: ServerStreamCtx,
  chunk: unknown,
  index: number
): void {
  for (const o of observers) {
    safeCall(o.onChunk ? () => o.onChunk!(ctx, chunk, index) : undefined);
  }
}

export function fanEnd(
  observers: ReadonlyArray<StreamObserver<unknown, unknown>>,
  ctx: ServerStreamCtx,
  info: { chunks: number; result: unknown }
): void {
  for (const o of observers) {
    safeCall(o.onEnd ? () => o.onEnd!(ctx, info) : undefined);
  }
}

export function fanError(
  observers: ReadonlyArray<StreamObserver<unknown, unknown>>,
  ctx: ServerStreamCtx,
  err: unknown,
  info: { chunks: number }
): void {
  for (const o of observers) {
    safeCall(o.onError ? () => o.onError!(ctx, err, info) : undefined);
  }
}

export function fanAbort(
  observers: ReadonlyArray<StreamObserver<unknown, unknown>>,
  ctx: ServerStreamCtx,
  info: { chunks: number }
): void {
  for (const o of observers) {
    safeCall(o.onAbort ? () => o.onAbort!(ctx, info) : undefined);
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/iso/src/internal/__tests__/stream-observer-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/stream-observer-runner.ts packages/iso/src/internal/__tests__/stream-observer-runner.test.ts
git commit -m "feat(iso): add stream-observer-runner with failure isolation"
```

---

## Task 13: page-middleware-host (new component, not wired yet)

**Files:**
- Create: `packages/iso/src/internal/page-middleware-host.tsx`
- Create: `packages/iso/src/internal/__tests__/page-middleware-host.test.tsx`

This component replaces `Guards`. It runs the page-scope middleware chain (filtered by `runs`) and renders either the page children, an alternative render (`render` outcome), nothing while suspended, or triggers preact-iso navigation on `redirect`.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/page-middleware-host.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/preact';
import { h } from 'preact';
import { LocationProvider } from 'preact-iso';
import { defineServerMiddleware, defineClientMiddleware } from '../../define-middleware.js';
import { PageMiddlewareHost } from '../page-middleware-host.js';
import { redirect, deny } from '../../outcomes.js';
import { render as renderOutcome } from '../../page-only.js';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
  route: () => {},
} as never;

describe('PageMiddlewareHost', () => {
  it('renders children when no middleware short-circuits (client)', async () => {
    const mw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    // Suspense-driven; wait a microtask for the chain to resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText('page-content')).not.toBeNull();
  });

  it('renders the alternative component on render() outcome', async () => {
    const Alt = () => <div>alternative</div>;
    const mw = defineClientMiddleware(async () => {
      throw renderOutcome(Alt);
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText('alternative')).not.toBeNull();
    expect(screen.queryByText('page-content')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/internal/__tests__/page-middleware-host.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/internal/page-middleware-host.tsx`:

```tsx
import {
  type ComponentChildren,
  type FunctionComponent,
  type JSX,
} from 'preact';
import type { Context } from 'hono';
import { type RouteHook, useLocation } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useContext, useRef } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
import {
  isOutcome,
  isRedirect,
  isRender,
  type Outcome,
} from '../outcomes.js';
import type {
  ServerMiddleware,
  ClientMiddleware,
  Middleware,
} from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';
import { dispatchServer, dispatchClient } from './middleware-runner.js';
import { partitionUse } from './use-partitioner.js';
import wrapPromise from './wrap-promise.js';
import { HonoRequestContext } from './contexts.js';

type UseEntry = Middleware | StreamObserver<unknown, unknown>;

type HostResult = { outcome: Outcome | undefined };

function startChain(
  use: ReadonlyArray<UseEntry>,
  location: RouteHook,
  honoCtx: Context | undefined
): Promise<HostResult> {
  const { middleware } = partitionUse(use);

  if (isBrowser()) {
    const client = middleware.filter(
      (m): m is ClientMiddleware => m.runs === 'client'
    );
    if (client.length === 0) return Promise.resolve({ outcome: undefined });
    return dispatchClient({
      middleware: client,
      ctx: { scope: 'page', location },
      inner: async () => undefined,
    }).then((r) =>
      r.kind === 'outcome' ? { outcome: r.outcome } : { outcome: undefined }
    );
  }

  const server = middleware.filter(
    (m): m is ServerMiddleware => m.runs === 'server'
  );
  if (server.length === 0) return Promise.resolve({ outcome: undefined });
  if (!honoCtx) {
    throw new Error(
      '<PageMiddlewareHost> rendered server-side without a HonoContext.Provider. ' +
        'renderPage must wrap the prerendered tree in <HonoContext.Provider value={{ context: c }}>.'
    );
  }
  return dispatchServer({
    middleware: server,
    ctx: {
      scope: 'page',
      c: honoCtx,
      signal: (honoCtx.req?.raw?.signal ?? new AbortController().signal) as AbortSignal,
      location,
    },
    inner: async () => undefined,
  }).then((r) =>
    r.kind === 'outcome' ? { outcome: r.outcome } : { outcome: undefined }
  );
}

type RefValue = { current: { read: () => HostResult } };

function HostConsumer({
  resultRef,
  children,
}: {
  resultRef: RefValue;
  children: ComponentChildren;
}) {
  const { outcome } = resultRef.current.read();
  const { route } = useLocation();

  if (outcome === undefined) {
    return <>{children}</>;
  }
  if (isRedirect(outcome)) {
    if (isBrowser()) {
      route(outcome.to);
      return null;
    }
    // Server: rethrow so renderPage's outer handler can translate to HTTP redirect.
    throw outcome;
  }
  if (isRender(outcome)) {
    const Alt = outcome.Component;
    return <Alt />;
  }
  // Deny on the page-render path: surface via errorFallback chain by rethrowing.
  throw outcome;
}

export const PageMiddlewareHost: FunctionComponent<{
  use?: ReadonlyArray<UseEntry>;
  location: RouteHook;
  fallback?: JSX.Element;
  children: ComponentChildren;
}> = ({ use = [], location, fallback, children }) => {
  const honoCtx = useContext(HonoRequestContext).context;
  const prevPath = useRef(location.path);
  const resultRef = useRef(wrapPromise(startChain(use, location, honoCtx)));
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    resultRef.current = wrapPromise(startChain(use, location, honoCtx));
  }
  return (
    <Suspense fallback={fallback}>
      <HostConsumer resultRef={resultRef}>{children}</HostConsumer>
    </Suspense>
  );
};
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/iso/src/internal/__tests__/page-middleware-host.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/page-middleware-host.tsx packages/iso/src/internal/__tests__/page-middleware-host.test.tsx
git commit -m "feat(iso): add PageMiddlewareHost component"
```

---

## Task 14: Add `use` to definePage (additively; keep `guards` working)

**Files:**
- Modify: `packages/iso/src/define-page.tsx`
- Modify: `packages/iso/src/page.tsx`
- Create: `packages/iso/src/__tests__/define-page-use.test.tsx`

In this task we add the `use` field to `PageBindings` and pass it through to the `Page` component. We do NOT yet swap `Guards` for `PageMiddlewareHost` — that swap happens in Task 26 after applications are migrated. Until then, `definePage` accepts both `guards` and `use`; only `guards` runs at the page level. The new `use` field is a no-op for now, with a test confirming the type accepts entries.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/define-page-use.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { definePage } from '../define-page.js';
import { defineServerMiddleware, defineClientMiddleware } from '../define-middleware.js';
import { defineStreamObserver } from '../define-stream-observer.js';

describe('definePage(use)', () => {
  it('accepts a `use` array of mixed middleware and observers without error', () => {
    const mw = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const clientMw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    const obs = defineStreamObserver({ onStart: () => {} });
    const Component = () => null;
    const PageRoute = definePage(Component, { use: [mw, clientMw, obs] });
    expect(typeof PageRoute).toBe('function');
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/__tests__/define-page-use.test.tsx`
Expected: FAIL (type error or no `use` option).

- [ ] **Step 3: Update `define-page.tsx`**

Replace `packages/iso/src/define-page.tsx`:

```tsx
import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { GuardFn } from './guard.js';
import type { PageUse } from './internal/use-types.js';
import { Page, type WrapperProps } from './page.js';

export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  guards?: GuardFn[];
  /**
   * Page-scope middleware and stream observers. Replaces `guards` in Phase 8.
   * For now, both fields are accepted; only `guards` is wired to the runtime.
   */
  use?: PageUse;
};

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page
      Wrapper={bindings?.Wrapper}
      errorFallback={bindings?.errorFallback}
      guards={bindings?.guards}
      use={bindings?.use}
      location={location}
    >
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
```

- [ ] **Step 4: Update `page.tsx` to accept (but not yet use) the `use` prop**

Replace `packages/iso/src/page.tsx`:

```tsx
import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useId } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import type { GuardFn } from './guard.js';
import type { PageUse } from './internal/use-types.js';
import { Guards } from './internal/guards.js';
import { RouteBoundary } from './internal/route-boundary.js';

export type WrapperProps = {
  id: string;
  'data-loader': string;
  children: ComponentChildren;
};

const DefaultWrapper: FunctionComponent<WrapperProps> = (props) => (
  <section {...props} />
);

export type PageProps = {
  location: RouteHook;
  guards?: GuardFn[];
  use?: PageUse;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  Wrapper?: ComponentType<WrapperProps>;
  children: ComponentChildren;
};

export function Page({
  location,
  guards,
  use: _use, // accepted but not wired until Phase 8
  errorFallback,
  Wrapper,
  children,
}: PageProps): JSX.Element {
  const id = useId();
  const W = Wrapper ?? DefaultWrapper;
  return (
    <RouteBoundary errorFallback={errorFallback}>
      <Guards guards={guards} location={location}>
        <W id={id} data-loader="null">
          {children}
        </W>
      </Guards>
    </RouteBoundary>
  );
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test packages/iso/src/__tests__/define-page-use.test.tsx`
Expected: PASS.

Also run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-page.tsx packages/iso/src/page.tsx packages/iso/src/__tests__/define-page-use.test.tsx
git commit -m "feat(iso): accept use[] on definePage (not yet wired)"
```

---

## Task 15: Add `use` to defineLoader with overload-gating

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Create: `packages/iso/src/__tests__/define-loader-use.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/define-loader-use.test.tsx`:

```ts
import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';
import { defineServerMiddleware } from '../define-middleware.js';
import { defineStreamObserver } from '../define-stream-observer.js';

describe('defineLoader(use)', () => {
  it('accepts middleware on a non-streaming loader', () => {
    const mw = defineServerMiddleware<'loader'>(async (_ctx, next) => {
      await next();
    });
    const ref = defineLoader(async () => ({ items: [1, 2] }), { use: [mw] });
    expect(ref.fn).toBeDefined();
  });

  it('accepts a stream observer on a streaming loader', () => {
    const obs = defineStreamObserver<number>({ onChunk: () => {} });
    const ref = defineLoader<number>(
      async function* () {
        yield 1;
        yield 2;
      },
      { use: [obs] }
    );
    expect(ref.fn).toBeDefined();
  });

  // Type-level: a non-streaming loader given a stream observer in `use` should
  // fail to compile. We can't assert that at runtime, but the typecheck step
  // catches it. Document the expectation here for the reader.
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/__tests__/define-loader-use.test.tsx`
Expected: FAIL (type error or option not accepted).

- [ ] **Step 3: Modify `define-loader.ts`**

Apply the following changes to `packages/iso/src/define-loader.ts`:

a. Add imports near the top:

```ts
import type { ServerMiddleware } from './define-middleware.js';
import type { LoaderUse } from './internal/use-types.js';
```

b. Add a `use` field to `DefineLoaderOpts<T>`:

```ts
export type DefineLoaderOpts<T> = {
  __moduleKey?: string;
  __loaderName?: string;
  cache?: LoaderCache<T>;
  params?: string[] | '*';
  /**
   * Per-loader middleware and (for streaming loaders) stream observers.
   * Overload-gated by the loader's return type: stream observers are only
   * permitted when the loader returns a ReadableStream or AsyncGenerator.
   */
  use?: LoaderUse<T, boolean>;
};
```

c. Add `use` to the `LoaderRef<T>` interface:

```ts
export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly __moduleKey?: string;
  readonly __loaderName?: string;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  readonly params: string[] | '*';
  readonly use: ReadonlyArray<unknown>;
  // ...remainder unchanged
}
```

d. In the `defineLoader` function body, attach `use` to the returned `ref`:

```ts
const ref: LoaderRef<T> = {
  __id,
  __moduleKey: opts?.__moduleKey,
  __loaderName: opts?.__loaderName,
  fn,
  cache: cache!,
  params: opts?.params ?? [],
  use: opts?.use ?? [],
  // ...existing useData/useError/invalidate/Boundary/View
};
```

The overload gate on `use` (streaming-vs-non) is enforced by the `LoaderUse<T, Streaming>` type when consumers thread the right `Streaming` flag. For v1 we accept both shapes at the unified entry point; the static gate is added in a follow-up when overload signatures are introduced. Document in code that the runtime accepts both.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/iso/src/__tests__/define-loader-use.test.tsx packages/iso/src/__tests__/define-loader.test.ts`
Expected: PASS.

Also: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader-use.test.tsx
git commit -m "feat(iso): accept use[] on defineLoader"
```

---

## Task 16: Add `use` to defineAction (signature change)

**Files:**
- Modify: `packages/iso/src/action.ts`
- Create: `packages/iso/src/__tests__/define-action-use.test.ts`

`defineAction` currently takes only `(fn)`. This task widens it to `(fn, opts?)` with the opts bag carrying `use`. Existing callers `defineAction(fn)` continue to work since `opts` is optional.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/define-action-use.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';
import { defineServerMiddleware } from '../define-middleware.js';

describe('defineAction(use)', () => {
  it('accepts a use array of action-scope middleware', () => {
    const mw = defineServerMiddleware<'action'>(async (_c, next) => {
      await next();
    });
    const stub = defineAction(async () => ({ ok: true }), { use: [mw] });
    expect(stub).toBeDefined();
  });

  it('continues to accept (fn) without opts (no-opts call signature)', () => {
    const stub = defineAction(async () => ({ ok: true }));
    expect(stub).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test packages/iso/src/__tests__/define-action-use.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify `action.ts`**

In `packages/iso/src/action.ts`, change the `defineAction` signature and attach the `use` array to the returned stub:

```ts
import type { ServerMiddleware } from './define-middleware.js';
import type { ActionUse } from './internal/use-types.js';

export type DefineActionOpts<TChunk = never, TResult = unknown> = {
  use?: ActionUse<TChunk, TResult, boolean>;
};

export function defineAction<TPayload, TResult, TChunk = never>(
  fn: ActionFn<TPayload, TResult, TChunk>,
  opts?: DefineActionOpts<TChunk, TResult>
): ActionStub<TPayload, TResult, TChunk> {
  // Attach `use` to the function for the actions-handler to read. The
  // ActionStub type at runtime IS the function; we mutate it with metadata.
  const stub = fn as unknown as ActionStub<TPayload, TResult, TChunk> & {
    use?: ReadonlyArray<unknown>;
  };
  if (opts?.use) stub.use = opts.use;
  return stub;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/iso/src/__tests__/define-action-use.test.ts packages/iso/src/__tests__/action.test.tsx`
Expected: PASS.

Also: `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/__tests__/define-action-use.test.ts
git commit -m "feat(iso): accept use[] on defineAction"
```

---

## Task 17: Wire dispatcher into loader execution path (SSR-inline + RPC)

**Files:**
- Modify: `packages/iso/src/internal/loader-runner.ts`
- Modify: `packages/server/src/loaders-handler.ts`

This task threads the middleware dispatcher into both paths that execute a loader: the SSR-inline direct-fn path in `loader-runner.ts` and the RPC handler in `loaders-handler.ts`. Page-layer and root-layer chains are not yet attached in this task (those come in Task 19 once we have the threading infrastructure); only the per-unit `loaderRef.use` is dispatched.

- [ ] **Step 1: Modify the loader-runner direct-fn path**

In `packages/iso/src/internal/loader-runner.ts`, replace the IIFE that invokes `loaderRef.fn(ctx)` with a dispatcher call. Locate the block:

```ts
return (async () => {
  const ctx = {
    location,
    signal,
    get c(): Context {
      // ...
    },
  };
  const result = await (loaderRef.fn(ctx) as Promise<unknown>);
  if (isAsyncGenerator(result)) {
    // ...
  }
  return result as T;
})();
```

Wrap the loader fn invocation in `dispatchServer`. New version:

```ts
import { dispatchServer } from './middleware-runner.js';
import { partitionUse } from './use-partitioner.js';
import { isOutcome } from '../outcomes.js';
import type { ServerMiddleware, ServerLoaderCtx } from '../define-middleware.js';

// ...inside runLoader's direct-fn branch:
return (async () => {
  const c = getRequestHonoContext<Context>();
  if (c === undefined) {
    throw new Error(
      'ctx.c is not available: this loader was invoked without an active server request scope. ' +
        'Loaders that read ctx.c run inside loadersHandler (RPC) or renderPage (SSR); test/edge paths must avoid reading it.'
    );
  }
  const ctx: ServerLoaderCtx = {
    scope: 'loader',
    c,
    signal,
    location,
    module: loaderRef.__moduleKey ?? '<unkeyed>',
    loader: loaderName,
  };
  const { middleware } = partitionUse(
    (loaderRef.use ?? []) as ReadonlyArray<never>
  );
  const serverMw = middleware.filter(
    (m): m is ServerMiddleware<'loader'> => m.runs === 'server'
  );

  const dispatch = await dispatchServer({
    middleware: serverMw,
    ctx,
    inner: async () => loaderRef.fn(ctx as never) as Promise<unknown>,
  });

  if (dispatch.kind === 'outcome') {
    throw dispatch.outcome;
  }
  const result = dispatch.value;
  if (isAsyncGenerator(result)) {
    const step = await result.next();
    if (step.done) return undefined as T;
    registerServerStreamingLoader(id, result);
    return step.value as T;
  }
  return result as T;
})();
```

(Adjust unused-binding warnings; remove the inline ctx-getter pattern since `c` is resolved up front.)

- [ ] **Step 2: Modify loaders-handler to dispatch per-unit middleware**

In `packages/server/src/loaders-handler.ts`, change the loader invocation block to use the dispatcher. Locate:

```ts
const result = await runRequestScope(
  () =>
    Promise.resolve(loaderFn({ c, location: validatedLocation, signal })),
  { honoContext: c }
);
```

Replace with:

```ts
import { dispatchServer } from '@hono-preact/iso/internal';
import { partitionUse } from '@hono-preact/iso/internal';
import type { ServerMiddleware, ServerLoaderCtx } from '@hono-preact/iso';

// ...later in the request handler, after loaderFn lookup:
const ctx: ServerLoaderCtx = {
  scope: 'loader',
  c,
  signal,
  location: validatedLocation as never,
  module,
  loader: loaderName,
};
const perUnitUse = (loaderRefByKey[`${module}::${loaderName}`]?.use ?? []) as ReadonlyArray<never>;
const { middleware } = partitionUse(perUnitUse);
const serverMw = middleware.filter(
  (m): m is ServerMiddleware<'loader'> => m.runs === 'server'
);

const dispatch = await runRequestScope(
  () =>
    dispatchServer({
      middleware: serverMw,
      ctx,
      inner: async () => loaderFn({ c, location: validatedLocation, signal } as never),
    }),
  { honoContext: c }
);

let result: unknown;
if (dispatch.kind === 'outcome') {
  // Outcome translation lives in Task 19 (full handler outcome translation).
  // For now, rethrow so the existing catch translates redirects via __redirect
  // envelope; deny/render translation is added in Task 19.
  throw dispatch.outcome;
}
result = dispatch.value;
```

This task ALSO requires building a `loaderRefByKey` lookup so we can read `loaderRef.use` per dispatch. Update `buildLoadersMap` to also produce a parallel map of `LoaderRef`s, or extend the existing map's value to be the full ref.

The simplest change: have `buildLoadersMap` return `Record<string, { fn: LoaderFn; use: ReadonlyArray<unknown> }>` and update lookups accordingly. Apply that refactor in this task.

- [ ] **Step 3: Run loader tests**

Run: `pnpm test packages/iso/src/__tests__/loader-runner-c.test.tsx packages/server/src/__tests__/loaders-handler-multi.test.ts`
Expected: PASS (existing loader behavior preserved; new middleware path runs no middleware when none is attached).

- [ ] **Step 4: Add an integration test exercising loader middleware**

Create `packages/iso/src/__tests__/loader-middleware.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';
import { defineServerMiddleware } from '../define-middleware.js';
import { runLoader } from '../internal/loader-runner.js';
import { runRequestScope } from '../cache.js';
import type { Context } from 'hono';

const fakeC = { req: { raw: { signal: new AbortController().signal } } } as unknown as Context;

describe('loader middleware runs around the loader fn', () => {
  it('wraps the loader call with before/after hooks', async () => {
    const calls: string[] = [];
    const wrapper = defineServerMiddleware<'loader'>(async (_ctx, next) => {
      calls.push('before');
      await next();
      calls.push('after');
    });

    const ref = defineLoader(
      async () => {
        calls.push('inner');
        return 'value';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [wrapper] }
    );

    const callbacks = {
      onChunk: () => {},
      onError: () => {},
      onEnd: () => {},
    };
    const value = await runRequestScope(
      () =>
        runLoader(
          ref,
          { path: '/', pathParams: {}, searchParams: {} } as never,
          'test-id',
          new AbortController().signal,
          callbacks
        ),
      { honoContext: fakeC }
    );
    expect(value).toBe('value');
    expect(calls).toEqual(['before', 'inner', 'after']);
  });
});
```

- [ ] **Step 5: Run the new test**

Run: `pnpm test packages/iso/src/__tests__/loader-middleware.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/loader-runner.ts packages/server/src/loaders-handler.ts packages/iso/src/__tests__/loader-middleware.test.tsx
git commit -m "feat: dispatch per-loader middleware on SSR-inline and RPC paths"
```

---

## Task 18: Wire dispatcher into action execution path

**Files:**
- Modify: `packages/server/src/actions-handler.ts`
- Create: `packages/iso/src/__tests__/action-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/action-middleware.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';
import { defineServerMiddleware } from '../define-middleware.js';

describe('action middleware', () => {
  it('use array is attached to the action stub for the dispatcher to read', () => {
    const mw = defineServerMiddleware<'action'>(async (_c, next) => {
      await next();
    });
    const stub = defineAction(async () => ({ ok: true }), { use: [mw] });
    expect((stub as unknown as { use: unknown[] }).use).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, verify pass (already wired in Task 16)**

Run: `pnpm test packages/iso/src/__tests__/action-middleware.test.ts`
Expected: PASS (the attachment was added in Task 16).

- [ ] **Step 3: Modify `actions-handler.ts` to dispatch per-action middleware**

In `packages/server/src/actions-handler.ts`, locate the section that invokes the resolved action function and wrap it with `dispatchServer`. The key change is to read `actionFn.use` and partition it for the dispatcher.

```ts
import { dispatchServer, partitionUse } from '@hono-preact/iso/internal';
import type { ServerMiddleware, ServerActionCtx } from '@hono-preact/iso';

// ...where the actionFn is currently invoked:
const ctx: ServerActionCtx = {
  scope: 'action',
  c,
  signal: c.req.raw.signal,
  module,
  action: actionName,
  payload,
};
const actionUse = (actionFn as { use?: ReadonlyArray<unknown> }).use ?? [];
const { middleware } = partitionUse(actionUse as ReadonlyArray<never>);
const serverMw = middleware.filter(
  (m): m is ServerMiddleware<'action'> => m.runs === 'server'
);

const dispatch = await dispatchServer({
  middleware: serverMw,
  ctx,
  inner: async () => (actionFn as Function)(ctx, payload) as Promise<unknown>,
});

if (dispatch.kind === 'outcome') {
  throw dispatch.outcome;
}
const result = dispatch.value;
```

This task only dispatches the per-action chain. App + page layers come in Task 19.

- [ ] **Step 4: Run action tests**

Run: `pnpm test packages/iso/src/__tests__/action.test.tsx packages/server/src/__tests__/action-loader-revalidation.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/actions-handler.ts packages/iso/src/__tests__/action-middleware.test.ts
git commit -m "feat(server): dispatch per-action middleware in actions-handler"
```

---

## Task 19: Thread appConfig + route table into handlers; full outcome translation

**Files:**
- Modify: `packages/server/src/loaders-handler.ts`
- Modify: `packages/server/src/actions-handler.ts`
- Modify: `packages/server/src/render.tsx`
- Modify: `packages/vite/src/server-entry.ts` (the generated entry)
- Modify: `packages/iso/src/internal.ts` (re-export new internals)

This task widens the handler options to accept `appConfig` (the root layer) and a per-handler-side route-table accessor for the page layer. It also implements the full outcome translation table from Section 4 of the spec.

- [ ] **Step 1: Re-export dispatcher internals**

In `packages/iso/src/internal.ts`, add:

```ts
export { dispatchServer, dispatchClient } from './internal/middleware-runner.js';
export { partitionUse } from './internal/use-partitioner.js';
export {
  fanStart,
  fanChunk,
  fanEnd,
  fanError,
  fanAbort,
} from './internal/stream-observer-runner.js';
```

- [ ] **Step 2: Widen `LoadersHandlerOptions` and `ActionsHandlerOptions`**

In `packages/server/src/loaders-handler.ts`:

```ts
import type { AppConfig } from '@hono-preact/iso';

export interface LoadersHandlerOptions {
  dev?: boolean;
  onError?: (err: unknown, ctx: { module: string; loader: string }) => void;
  appConfig?: AppConfig;
  resolvePageUse?: (path: string) => ReadonlyArray<unknown>;
}
```

Apply the same shape to `ActionsHandlerOptions` in `actions-handler.ts`, with `resolvePageUse?: (moduleKey: string) => ReadonlyArray<unknown>` (action's owning page is unambiguous from module key).

- [ ] **Step 3: Compose the full chain in both handlers**

Inside each handler, compose the chain as `[...appConfig.use, ...pageUse, ...unitUse]` before dispatching. Filter to server middleware. Pass to `dispatchServer`.

```ts
const rootUse = opts.appConfig?.use ?? [];
const pageUse = opts.resolvePageUse?.(validatedLocation.path) ?? [];
const fullUse = [...rootUse, ...pageUse, ...perUnitUse];
const { middleware } = partitionUse(fullUse as ReadonlyArray<never>);
const serverMw = middleware.filter(
  (m): m is ServerMiddleware<'loader'> => m.runs === 'server'
);
```

- [ ] **Step 4: Implement outcome translation**

In both handlers, replace the bare `throw dispatch.outcome` from earlier tasks with full translation:

```ts
if (dispatch.kind === 'outcome') {
  const o = dispatch.outcome;
  if (o.__outcome === 'redirect') {
    return c.json(
      { __outcome: 'redirect', to: o.to, status: o.status, headers: o.headers },
      200
    );
  }
  if (o.__outcome === 'deny') {
    // Apply optional headers
    if (o.headers) {
      for (const [k, v] of Object.entries(o.headers)) c.header(k, v);
    }
    return c.json({ __outcome: 'deny', message: o.message }, o.status);
  }
  // 'render' is page-scope only; receiving one here is a programmer error
  // (the page-only subpath import policy prevents it statically, but defense
  // in depth catches stray uses).
  return c.json(
    { __outcome: 'error', message: 'render outcome is page-scope only' },
    500
  );
}
```

- [ ] **Step 5: Update render.tsx to dispatch the root + page chain**

In `packages/server/src/render.tsx`, find where the page Component is invoked / the tree is built, and wrap the dispatch around the prerender. Outcome translations on the SSR path:

- `redirect`: return an HTTP redirect response (`c.redirect(o.to, o.status)`, applying headers).
- `deny`: return a JSON or HTML error response at the appropriate status (rendered through the page's `errorFallback`).
- `render`: prerender `<o.Component />` in place of the matched page.

```ts
// Pseudo-code, adapt to render.tsx's actual control flow:
const rootUse = opts.appConfig?.use ?? [];
const pageUse = pageModule.use ?? [];
const { middleware } = partitionUse([...rootUse, ...pageUse]);
const serverMw = middleware.filter(
  (m): m is ServerMiddleware<'page'> => m.runs === 'server'
);

const ctx: ServerPageCtx = {
  scope: 'page',
  c,
  signal: c.req.raw.signal,
  location,
};

const dispatch = await dispatchServer({
  middleware: serverMw,
  ctx,
  inner: async () => undefined, // page render lives outside the dispatch
});

if (dispatch.kind === 'outcome') {
  const o = dispatch.outcome;
  if (o.__outcome === 'redirect') {
    if (o.headers) for (const [k, v] of Object.entries(o.headers)) c.header(k, v);
    return c.redirect(o.to, o.status);
  }
  if (o.__outcome === 'deny') {
    if (o.headers) for (const [k, v] of Object.entries(o.headers)) c.header(k, v);
    return c.text(o.message ?? 'Forbidden', o.status);
  }
  if (o.__outcome === 'render') {
    // Substitute the alternative component for the page in the prerender tree.
    pageModule.Component = o.Component;
  }
}

// ...continue with normal prerender, but using pageModule.Component which may
// have been swapped above.
```

The exact integration with `prerender` and the route table is codebase-specific; consult `packages/server/src/render.tsx` for the existing shape and adapt.

- [ ] **Step 6: Update the generated server entry to thread appConfig and the route table**

In `packages/vite/src/server-entry.ts`, augment the generated entry template to import the user's `defineApp` result (default-exported from `apps/app/src/app-config.ts` by convention) and thread it into the handlers and renderPage.

The generated entry will look like:

```ts
// generated
import { app as userApp } from './api';
import appConfig from './app-config';
import { routeTable } from './<generated route-table module>';

export const app = new Hono()
  .post('/__loaders', loadersHandler(serverModules, {
    appConfig,
    resolvePageUse: (path) => routeTable.matchPage(path)?.use ?? [],
  }))
  .post('/__actions', actionsHandler(serverModules, {
    appConfig,
    resolvePageUse: (moduleKey) => routeTable.pageModuleFor(moduleKey)?.use ?? [],
  }))
  .route('/', userApp)
  .use(location)
  .get('*', (c) => renderPage(c, ..., { appConfig }));
```

`apps/app/src/app-config.ts` is a user file; the plan does not create it for them, but the generated entry assumes it exists. The Vite plugin should gracefully handle a missing file (treat as `defineApp({})`).

- [ ] **Step 7: Run all server tests**

Run: `pnpm test packages/server/src/__tests__/`
Expected: PASS (existing behavior preserved; new chains are empty in fixtures, so no behavior change).

- [ ] **Step 8: Add an integration test exercising the root → page → unit chain**

Create `packages/server/src/__tests__/middleware-chain.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { defineLoader, defineApp, defineServerMiddleware } from '@hono-preact/iso';
import { loadersHandler } from '../loaders-handler.js';

describe('loaders-handler dispatches the full chain (root → page → unit)', () => {
  it('runs middleware in outer→inner order', async () => {
    const calls: string[] = [];
    const root = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('root:before');
      await next();
      calls.push('root:after');
    });
    const page = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('page:before');
      await next();
      calls.push('page:after');
    });
    const unit = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('unit:before');
      await next();
      calls.push('unit:after');
    });

    const loader = defineLoader(
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [unit] }
    );

    const serverModules: Record<string, unknown> = {
      'test/m': {
        __moduleKey: 'test/m',
        serverLoaders: { l: loader },
      },
    };

    const appConfig = defineApp({ use: [root] });

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, {
        appConfig,
        resolvePageUse: () => [page],
      })
    );

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      'root:before',
      'page:before',
      'unit:before',
      'inner',
      'unit:after',
      'page:after',
      'root:after',
    ]);
  });
});
```

- [ ] **Step 9: Run the new test**

Run: `pnpm test packages/server/src/__tests__/middleware-chain.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/loaders-handler.ts packages/server/src/actions-handler.ts packages/server/src/render.tsx packages/vite/src/server-entry.ts packages/iso/src/internal.ts packages/server/src/__tests__/middleware-chain.test.tsx
git commit -m "feat(server): thread appConfig + page chain through handlers and renderPage"
```

---

## Task 20: Extend guard-strip Vite plugin allowlist

**Files:**
- Modify: `packages/vite/src/guard-strip.ts`
- Modify: `packages/vite/src/__tests__/guard-strip-plugin.test.ts`

The existing plugin strips calls to `defineServerGuard` / `defineClientGuard` from the opposite-env bundle. Extend the allowlist to also strip `defineServerMiddleware`, `defineClientMiddleware`, and `defineStreamObserver` from the wrong-env bundle, replacing them with no-op brand objects.

- [ ] **Step 1: Read the existing plugin to understand the rewrite shape**

Open `packages/vite/src/guard-strip.ts` and `packages/vite/src/__tests__/guard-strip-plugin.test.ts` for context. The plugin's pattern is keyword-list-driven; extend the keyword list and the rewrite output.

- [ ] **Step 2: Add the new symbols to the allowlist + rewrite**

Locate where `defineServerGuard` / `defineClientGuard` are matched. Add `defineServerMiddleware`, `defineClientMiddleware`, `defineStreamObserver` to the same matching logic. The rewrite output for the wrong-env case:

- `defineServerMiddleware(...)` in a client bundle → `{ __kind: 'middleware', runs: 'server', fn: () => Promise.resolve() }`.
- `defineClientMiddleware(...)` in a server bundle → `{ __kind: 'middleware', runs: 'client', fn: () => Promise.resolve() }`.
- `defineStreamObserver(...)` in a client bundle → `{ __kind: 'observer' }` (a no-op record).

- [ ] **Step 3: Write tests for the new symbols**

Append to `packages/vite/src/__tests__/guard-strip-plugin.test.ts`:

```ts
describe('guard-strip extends to middleware/observer helpers', () => {
  it('rewrites defineServerMiddleware in the client bundle to a no-op brand object', async () => {
    const input = `
      import { defineServerMiddleware } from '@hono-preact/iso';
      export const mw = defineServerMiddleware(async (_c, next) => { await next(); });
    `;
    const output = await runPlugin(input, { isServer: false });
    expect(output).toMatch(/__kind:\s*['"]middleware['"]/);
    expect(output).toMatch(/runs:\s*['"]server['"]/);
    expect(output).not.toMatch(/defineServerMiddleware\s*\(/);
  });

  it('rewrites defineClientMiddleware in the server bundle to a no-op brand object', async () => {
    const input = `
      import { defineClientMiddleware } from '@hono-preact/iso';
      export const mw = defineClientMiddleware(async (_c, next) => { await next(); });
    `;
    const output = await runPlugin(input, { isServer: true });
    expect(output).toMatch(/runs:\s*['"]client['"]/);
    expect(output).not.toMatch(/defineClientMiddleware\s*\(/);
  });

  it('rewrites defineStreamObserver in the client bundle to a no-op observer record', async () => {
    const input = `
      import { defineStreamObserver } from '@hono-preact/iso';
      export const obs = defineStreamObserver({ onChunk: () => {} });
    `;
    const output = await runPlugin(input, { isServer: false });
    expect(output).toMatch(/__kind:\s*['"]observer['"]/);
    expect(output).not.toMatch(/defineStreamObserver\s*\(/);
  });
});
```

(Adapt `runPlugin` to match the existing test harness in this file.)

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/vite/src/__tests__/guard-strip-plugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/guard-strip.ts packages/vite/src/__tests__/guard-strip-plugin.test.ts
git commit -m "feat(vite): extend guard-strip allowlist for middleware/observer symbols"
```

---

## Task 21: Surface pageUse / loaderUse / actionUse through the server-loaders parser

**Files:**
- Modify: `packages/vite/src/server-loaders-parser.ts`
- Modify: `packages/vite/src/__tests__/server-loaders-parser.test.ts`

The parser extracts named exports from `.server.ts` files (`serverLoaders`, `serverActions`, `actionGuards` today). Extend it to also recognize `use` exports on loaders, actions, and pages so the dispatcher can find them at runtime.

- [ ] **Step 1: Read the existing parser to understand its export-recognition logic**

Open `packages/vite/src/server-loaders-parser.ts` for context.

- [ ] **Step 2: Add `use` recognition**

For each `defineLoader` / `defineAction` call in a `.server.ts` module, the parser should ensure the resulting reference carries its `use` field through to the emitted module shape. Since the `use` field is attached to the ref/stub by the constructor (Tasks 15 and 16), the parser typically does not need to do anything special — the existing serialization of `serverLoaders` / `serverActions` already carries object properties through.

For `definePage`, the page module exports its `use` array via the function-property attachment in `define-page.tsx`. Add a sibling `pageUse` export to the parser's emit so the server-modules glob can find it:

```ts
// After parsing a definePage call site:
const useExpr = extractUseArgument(definePageCallExpression);
if (useExpr) {
  emit(`export const pageUse = ${useExprSource};`);
}
```

(Implementation detail varies with the existing AST traversal in the parser. Adapt to the existing style.)

- [ ] **Step 3: Write a parser test**

Append to `packages/vite/src/__tests__/server-loaders-parser.test.ts`:

```ts
it('emits pageUse for a page module that passes use to definePage', async () => {
  const input = `
    import { definePage, defineServerMiddleware } from '@hono-preact/iso';
    const mw = defineServerMiddleware(async (_c, next) => { await next(); });
    export default definePage(() => null, { use: [mw] });
  `;
  const output = await runParser(input);
  expect(output).toMatch(/export const pageUse\b/);
});
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/vite/src/__tests__/server-loaders-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-loaders-parser.ts packages/vite/src/__tests__/server-loaders-parser.test.ts
git commit -m "feat(vite): surface pageUse export from server-loaders-parser"
```

---

## Task 22: Update server-modules consumer to read pageUse for resolvePageUse

**Files:**
- Modify: `packages/server/src/route-server-modules.ts`
- Modify: `packages/server/src/loaders-handler.ts`
- Modify: `packages/server/src/actions-handler.ts`

Now that `pageUse` exists as a module-level export, wire it into the `resolvePageUse` option for each handler.

- [ ] **Step 1: Extend `route-server-modules.ts` to also index pageUse by route**

In `packages/server/src/route-server-modules.ts`, add a function that builds a `routePath → pageUse` map from the modules glob. The map is built once on first use (or per request in dev) and consulted by the handler.

```ts
export async function buildPageUseMap(
  glob: LazyGlob | EagerGlob
): Promise<Map<string, ReadonlyArray<unknown>>> {
  const map = new Map<string, ReadonlyArray<unknown>>();
  for (const [filePath, modOrLoader] of Object.entries(glob)) {
    const mod = typeof modOrLoader === 'function' ? await modOrLoader() : modOrLoader;
    const moduleKey = (mod as { __moduleKey?: unknown }).__moduleKey;
    const pageUse = (mod as { pageUse?: ReadonlyArray<unknown> }).pageUse;
    if (typeof moduleKey === 'string' && Array.isArray(pageUse)) {
      // Compute route path from filePath using the same convention as the
      // route table; consult existing route-table helpers in this file.
      const routePath = filePathToRoutePath(filePath);
      map.set(routePath, pageUse);
    }
  }
  return map;
}
```

- [ ] **Step 2: Wire `resolvePageUse` in the generated entry**

In `packages/vite/src/server-entry.ts`, the generated entry should call `buildPageUseMap(serverModules)` (once) and pass `(path) => pageUseMap.get(path) ?? []` as `resolvePageUse`.

- [ ] **Step 3: Add a test that page-layer middleware fires**

Extend `packages/server/src/__tests__/middleware-chain.test.tsx` (Task 19) with a variant that wires `resolvePageUse` to a real map and verifies the page layer runs.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test packages/server/src/__tests__/middleware-chain.test.tsx packages/server/src/__tests__/loaders-handler-multi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/route-server-modules.ts packages/server/src/loaders-handler.ts packages/server/src/actions-handler.ts packages/vite/src/server-entry.ts
git commit -m "feat(server): wire pageUse map for handler resolvePageUse"
```

---

## Task 23: Migrate apps/site demo from guards to middleware

**Files:**
- Modify: `apps/site/src/demo/guard.ts`
- Modify: `apps/site/src/pages/demo/login.server.ts`
- Modify: `apps/site/src/pages/demo/projects.server.ts`
- Modify: `apps/site/src/pages/demo/project-issues.server.ts`
- Modify: `apps/site/src/pages/demo/issue.server.ts`
- Modify: `apps/site/src/pages/demo/__tests__/login.server.test.ts`
- Modify: any `definePage` callers in the demo that use `guards`

This is the application-side cut-over. After this task, `apps/site` no longer references the legacy guard helpers.

- [ ] **Step 1: Rewrite `apps/site/src/demo/guard.ts`**

Read the existing file to understand the helpers (`requireSession`, etc.). Rewrite each as middleware:

```ts
import {
  defineServerMiddleware,
  defineClientMiddleware,
  redirect,
} from '@hono-preact/iso';

export const requireSessionServer = defineServerMiddleware<'page'>(
  async (ctx, next) => {
    const sessionCookie = ctx.c.req.header('cookie')?.match(/session=([^;]+)/)?.[1];
    if (!sessionCookie) throw redirect('/demo/login');
    await next();
  }
);

export const requireSessionClient = defineClientMiddleware(async (ctx, next) => {
  if (typeof document !== 'undefined' && !document.cookie.includes('session=')) {
    throw redirect('/demo/login');
  }
  await next();
});

export const requireSession = [requireSessionServer, requireSessionClient];
```

(Adapt to whatever the existing guard logic actually does. The shape above mirrors the patterns the existing tests cover.)

- [ ] **Step 2: Rewrite action-guard usages in demo .server.ts files**

For each `.server.ts` file that exports `actionGuards = [...]`, replace with `use: [...]` passed to each `defineAction` call:

```ts
// Before:
export const actionGuards = [requireSessionAction];
export const serverActions = {
  login: defineAction(async (ctx, payload) => { /* ... */ }),
};

// After:
import { requireSession } from '../../demo/guard.js';
export const serverActions = {
  login: defineAction(
    async (ctx, payload) => { /* ... */ },
    { use: requireSession.filter(m => m.runs === 'server') }
  ),
};
```

(Or per-action lists as appropriate for the demo's intent.)

- [ ] **Step 3: Update `definePage` callers**

Find every `definePage(..., { guards: ... })` in `apps/site` and change to `{ use: ... }`. Grep:

Run: `grep -rn "guards:" apps/site/src --include="*.tsx" --include="*.ts"`

Replace each occurrence.

- [ ] **Step 4: Update the demo test files**

Rewrite `apps/site/src/pages/demo/__tests__/login.server.test.ts` to assert middleware behavior rather than guard behavior. Use the patterns from `packages/iso/src/internal/__tests__/middleware-runner.test.ts`.

- [ ] **Step 5: Run apps/site tests**

Run: `pnpm test apps/site/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/site/
git commit -m "refactor(site): migrate demo from guards/actionGuards to middleware"
```

---

## Task 24: Migrate apps/app and apps/example-node usages

**Files:**
- Modify: any file under `apps/app/` referencing `defineServerGuard` / `defineClientGuard` / `defineActionGuard` / `GuardRedirect` / `ActionGuardError`
- Modify: any file under `apps/example-node/` referencing the same

- [ ] **Step 1: Inventory existing usages**

Run: `grep -rn "defineServerGuard\|defineClientGuard\|defineActionGuard\|GuardRedirect\|ActionGuardError\|actionGuards\b\|guards:" apps/`

- [ ] **Step 2: Rewrite each occurrence using the patterns from Task 23**

For each file, replace the imports and call sites following the migration patterns established in Task 23.

- [ ] **Step 3: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test apps/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/
git commit -m "refactor(apps): migrate remaining guard usages to middleware"
```

---

## Task 25: Swap Guards for PageMiddlewareHost in Page component

**Files:**
- Modify: `packages/iso/src/page.tsx`

Now that `apps/` no longer relies on the legacy guards, swap the host component.

- [ ] **Step 1: Replace `Guards` with `PageMiddlewareHost` in `page.tsx`**

Edit `packages/iso/src/page.tsx`:

```tsx
import { PageMiddlewareHost } from './internal/page-middleware-host.js';
// remove: import { Guards } from './internal/guards.js';
// remove: import type { GuardFn } from './guard.js';

export type PageProps = {
  location: RouteHook;
  use?: PageUse;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  Wrapper?: ComponentType<WrapperProps>;
  children: ComponentChildren;
};
// remove: guards?: GuardFn[] field

export function Page({ location, use, errorFallback, Wrapper, children }: PageProps): JSX.Element {
  const id = useId();
  const W = Wrapper ?? DefaultWrapper;
  return (
    <RouteBoundary errorFallback={errorFallback}>
      <PageMiddlewareHost use={use} location={location}>
        <W id={id} data-loader="null">
          {children}
        </W>
      </PageMiddlewareHost>
    </RouteBoundary>
  );
}
```

- [ ] **Step 2: Drop `guards` from `definePage`**

In `packages/iso/src/define-page.tsx`, remove the `guards` field from `PageBindings` and from the prop passing:

```tsx
export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?: JSX.Element | ((error: Error, reset: () => void) => JSX.Element);
  use?: PageUse;
};

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page
      Wrapper={bindings?.Wrapper}
      errorFallback={bindings?.errorFallback}
      use={bindings?.use}
      location={location}
    >
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
```

- [ ] **Step 3: Run all tests + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/page.tsx packages/iso/src/define-page.tsx
git commit -m "refactor(iso): swap Guards for PageMiddlewareHost; drop guards field from definePage"
```

---

## Task 26: Delete guard.ts and the legacy guard exports

**Files:**
- Delete: `packages/iso/src/guard.ts`
- Delete: `packages/iso/src/internal/guards.tsx`
- Delete: `packages/iso/src/__tests__/guard.test.ts`
- Delete: `packages/iso/src/__tests__/guards-honocontext.test.tsx`
- Delete: `packages/iso/src/__tests__/guards-filter.test.tsx`
- Modify: `packages/iso/src/index.ts`
- Modify: `packages/iso/src/internal.ts`
- Modify: `packages/iso/src/internal/contexts.ts`

- [ ] **Step 1: Delete guard files**

```bash
rm packages/iso/src/guard.ts
rm packages/iso/src/internal/guards.tsx
rm packages/iso/src/__tests__/guard.test.ts
rm packages/iso/src/__tests__/guards-honocontext.test.tsx
rm packages/iso/src/__tests__/guards-filter.test.tsx
```

- [ ] **Step 2: Remove guard exports from `packages/iso/src/index.ts`**

Delete the `// Guards.` section entirely:

```ts
// DELETE THIS BLOCK:
export {
  defineServerGuard,
  defineClientGuard,
  GuardRedirect,
  runServerGuards,
  runClientGuards,
} from './guard.js';
export type {
  GuardFn,
  ServerGuardFn,
  ClientGuardFn,
  GuardResult,
  ServerGuardContext,
  ClientGuardContext,
  GuardRunsOn,
} from './guard.js';
```

Also remove from `action.ts` re-exports:

```ts
// DELETE:
export { ActionGuardError, defineActionGuard } from './action.js';
export type {
  ActionGuardContext,
  ActionGuardFn,
} from './action.js';
```

- [ ] **Step 3: Add new exports to `packages/iso/src/index.ts`**

Append:

```ts
// Middleware + outcomes.
export {
  defineServerMiddleware,
  defineClientMiddleware,
} from './define-middleware.js';
export type {
  ServerMiddleware,
  ClientMiddleware,
  ServerBaseCtx,
  ServerPageCtx,
  ServerLoaderCtx,
  ServerActionCtx,
  ServerCtx,
  ClientPageCtx,
  Scope,
  Next,
  Middleware,
} from './define-middleware.js';

export { defineStreamObserver } from './define-stream-observer.js';
export type {
  StreamObserver,
  ServerStreamCtx,
} from './define-stream-observer.js';

export { defineApp } from './define-app.js';
export type { AppConfig, AppUseElement } from './define-app.js';

export {
  redirect,
  deny,
  isOutcome,
  isRedirect,
  isDeny,
  isRender,
} from './outcomes.js';
export type {
  Outcome,
  RedirectOutcome,
  DenyOutcome,
  RenderOutcome,
  RedirectStatusCode,
  ErrorStatusCode,
} from './outcomes.js';
```

Note: `render` is NOT re-exported from the root index; it lives only at `@hono-preact/iso/page`.

- [ ] **Step 4: Remove ActionGuardError + defineActionGuard from action.ts**

In `packages/iso/src/action.ts`, delete the following exports and their types:

```ts
// DELETE:
export type ActionGuardContext = { /* ... */ };
export type ActionGuardFn = /* ... */;
export class ActionGuardError extends Error { /* ... */ }
export const defineActionGuard = /* ... */;
```

- [ ] **Step 5: Remove GuardResultContext from contexts.ts**

In `packages/iso/src/internal/contexts.ts`, delete the `GuardResultContext` export and any references.

- [ ] **Step 6: Run all tests + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. If anything still references a deleted symbol, fix the references (most should have been caught in Tasks 23-24).

- [ ] **Step 7: Commit**

```bash
git add -A packages/iso/
git commit -m "refactor(iso): delete legacy guard primitives and action-guard helpers"
```

---

## Task 27: Stop reading actionGuards in actions-handler

**Files:**
- Modify: `packages/server/src/actions-handler.ts`

`actions-handler.ts` still reads `mod.actionGuards` and threads it through `runActionGuards`. With the legacy gone, this code path is dead. Remove it.

- [ ] **Step 1: Remove `actionGuards` reading and `runActionGuards`**

In `packages/server/src/actions-handler.ts`:

- Remove `actionGuards` from the `ModuleEntry` type and `buildActionsMap`.
- Delete the `runActionGuards` function.
- The dispatcher (added in Task 18) is now the only middleware path.

- [ ] **Step 2: Run server tests**

Run: `pnpm test packages/server/src/__tests__/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/actions-handler.ts
git commit -m "refactor(server): drop actionGuards reading from actions-handler"
```

---

## Task 28: Update `internal/contexts.ts` and remove guard.ts imports across the codebase

**Files:**
- Modify: `packages/iso/src/internal/contexts.ts`
- Any remaining file that imports from a deleted module

- [ ] **Step 1: Grep for stale references**

Run: `grep -rn "from '.*guard\\.js'\|from '@hono-preact/iso/guard'\|defineServerGuard\|defineClientGuard\|defineActionGuard\|ActionGuardError\|GuardRedirect\|GuardFn\|ServerGuardFn\|ClientGuardFn\|GuardResult\b\|runServerGuards\|runClientGuards" packages/ apps/`
Expected: empty.

If anything matches, fix each reference (most are caught earlier; this is a final sweep).

- [ ] **Step 2: Run full test suite + typecheck**

Run: `pnpm typecheck && pnpm test && pnpm test:integration`
Expected: all PASS.

- [ ] **Step 3: Commit any cleanup**

```bash
git add -A
git commit -m "chore: remove final stragglers of legacy guard imports"
```

(If nothing to commit, skip.)

---

## Task 29: Delete old docs pages

**Files:**
- Delete: `apps/site/src/pages/docs/guards.mdx`
- Delete: `apps/site/src/pages/docs/action-guards.mdx`

- [ ] **Step 1: Delete the files**

```bash
rm apps/site/src/pages/docs/guards.mdx
rm apps/site/src/pages/docs/action-guards.mdx
```

- [ ] **Step 2: Remove sidebar entries**

The docs sidebar is generated from the file tree (per `2026-04-16-docs-sidebar-design.md` and related). Verify by running `pnpm dev` for the site and confirming the deleted pages no longer appear. If the sidebar is configured manually somewhere, update it.

Run: `grep -rn "docs/guards\|docs/action-guards" apps/site/`
If anything matches, edit those references.

- [ ] **Step 3: Commit**

```bash
git add -A apps/site/src/pages/docs/
git commit -m "docs: delete obsolete guards.mdx and action-guards.mdx"
```

---

## Task 30: Write the new middleware docs page

**Files:**
- Create: `apps/site/src/pages/docs/middleware.mdx`

- [ ] **Step 1: Create the page**

Use the local skill `.claude/skills/add-docs-page.md` first to follow the repo's docs conventions. Read it:

```bash
cat .claude/skills/add-docs-page.md
```

Then create `apps/site/src/pages/docs/middleware.mdx`. The content should cover:

1. **What middleware is.** A `(ctx, next)` chain that wraps loader/action/page calls.
2. **The three layers** (root via `defineApp`, page via `definePage`, per-unit via `defineLoader` / `defineAction`).
3. **Server vs client middleware.** Why they're separate; the type-level differences.
4. **Outcomes** (`redirect`, `deny`, `render`). Examples for each. The page-only subpath import for `render`.
5. **Stream observers.** Lifecycle events; failure isolation; synchronous semantics.
6. **The `use` array.** Mixed entries; partitioned by the dispatcher; ordering.
7. **Worked examples**:
   - Auth gate with server + client expressions.
   - Timing middleware that logs duration.
   - Tracing middleware that opens/closes a span around the call.
   - Per-chunk audit observer.
   - Page render-replacement with `render(LoginModal)`.

Each example should be a complete, paste-able snippet.

- [ ] **Step 2: Verify the page renders**

Run: `pnpm dev` (in `apps/site`) and navigate to `/docs/middleware` to confirm it renders.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/docs/middleware.mdx
git commit -m "docs: add middleware.mdx covering the unified primitive"
```

---

## Task 31: Update structure.mdx to show defineApp

**Files:**
- Modify: `apps/site/src/pages/docs/structure.mdx`

- [ ] **Step 1: Open structure.mdx and find the section discussing app-level setup**

Read the existing structure docs to understand the framing.

- [ ] **Step 2: Add a section on the app config root**

Add a section that introduces `defineApp` as the place for root-level middleware and observers. Show:

```ts
// apps/app/src/app-config.ts
import { defineApp, defineServerMiddleware } from '@hono-preact/iso';

const withRequestId = defineServerMiddleware(async (ctx, next) => {
  const id = crypto.randomUUID();
  ctx.c.header('X-Request-Id', id);
  await next();
});

export default defineApp({
  use: [withRequestId],
});
```

Explain that the framework's generated server entry imports the default export from this file. Note that if no `app-config.ts` exists, the framework treats it as `defineApp({})`.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/docs/structure.mdx
git commit -m "docs: document defineApp as the root config in structure.mdx"
```

---

## Task 32: Final verification — full test + typecheck + format + lint

**Files:** none

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 2: Run unit tests**

Run: `pnpm test`
Expected: all PASS.

- [ ] **Step 3: Run integration tests**

Run: `pnpm test:integration`
Expected: all PASS.

- [ ] **Step 4: Run format check**

Run: `pnpm format:check`
Expected: no formatting errors. If errors, run `pnpm format` and commit.

- [ ] **Step 5: Build the framework packages**

Run: `pnpm build`
Expected: success across all framework packages and the site build.

- [ ] **Step 6: Smoke test the site**

Run: `pnpm dev` and open `http://localhost:5173` (or whatever port). Click through:
- The home page.
- `/docs/middleware` — verify it renders.
- The demo login flow — verify the auth gate redirects unauthenticated users.

- [ ] **Step 7: Final commit if any formatting changes**

```bash
git status
# if anything pending:
git add -A
git commit -m "chore: prettier --write across migrated files"
```

- [ ] **Step 8: Verify no legacy symbols remain**

Run: `grep -rn "defineServerGuard\|defineClientGuard\|defineActionGuard\|GuardRedirect\|ActionGuardError\|GuardFn\|GuardResult\|actionGuards:" packages/ apps/`
Expected: empty.

---

## Notes for the implementer

- **Treat the spec as the contract.** When this plan is ambiguous, defer to `docs/superpowers/specs/2026-05-20-loader-action-middleware-design.md`.
- **Frequent commits.** Each task is one commit minimum. If a step is large, commit between steps where natural.
- **TDD is non-negotiable.** Every behavior-introducing task has a failing test step before the implementation step. Run the test to see it fail; that confirms the test actually exercises the new code.
- **No back-compat shims.** The user's directive is "right for the long term, not minimal-now-upgrade-later." When deleting a symbol, delete its callers in the same logical commit (Phases 7-8 are the cohesive deletion window).
- **Coverage of edge cases.** The plan shows representative tests per task. The implementer should add additional tests for edge cases the design surfaces (e.g., outer middleware catching deny-then-rethrowing-render, signal abort mid-stream firing `onAbort`, etc.). Use the spec's "Dispatcher invariants" section as a coverage checklist.
- **If something doesn't fit.** If you find a structural problem during implementation that the plan didn't anticipate, stop and surface it before continuing. The plan is a hypothesis; reality may differ.

---

## Self-Review

**Spec coverage:** Every spec section maps to tasks:
- Outcomes → Task 1, 2, 19 (translation)
- Middleware primitives → Tasks 4–5
- Stream observer → Task 6
- defineApp → Task 7
- Use type generator + partitioner → Tasks 8–9
- Middleware runner + invariants → Tasks 10–11
- Stream observer runner + failure isolation → Task 12
- PageMiddlewareHost → Task 13
- definePage / defineLoader / defineAction integration → Tasks 14–18
- Handler integration + outcome translation → Task 19
- Vite plugin extensions → Tasks 20–21
- pageUse runtime wiring → Task 22
- Apps migration → Tasks 23–24
- Demolition → Tasks 25–28
- Docs → Tasks 29–31
- Final verification → Task 32

**Placeholder scan:** No "TBD", "TODO", "fill in details" markers. Every step has either code, a command, or a concrete file change.

**Type consistency check:** Type names (`ServerMiddleware`, `ClientMiddleware`, `StreamObserver`, `Outcome`, `Scope`, `Use`, `AppConfig`) appear identically across tasks. Method names (`defineServerMiddleware`, `defineClientMiddleware`, `defineStreamObserver`, `defineApp`, `redirect`, `deny`, `render`, `isOutcome`, `partitionUse`, `dispatchServer`, `dispatchClient`) are consistent.

**Sequencing check:** Tasks land additively through Task 22. Demolition starts at Task 23 (apps migration) and completes at Task 28. Docs cleanup at Tasks 29-31. Final verification at Task 32. Tests pass between every commit.
