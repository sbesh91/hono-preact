# Single Guards List + `ActionGuardError` Status Type Fix

**Date:** 2026-05-13
**Status:** Draft
**Scope:** v0.1 sequencing item 6. Page-guards only; action-guards architecture untouched (separate investigation: GitHub issue #33).

## TL;DR

Replace `definePage`'s two parallel `serverGuards` / `clientGuards` arrays with a single ordered `guards` list. Each guard declares where it runs by which factory built it: `defineServerGuard(fn)` or `defineClientGuard(fn)`. No unified `defineGuard`, no `runs: 'both'` option — environment is encoded in the factory name. Composition is array order regardless of env.

The Vite plugin statically rewrites `defineServerGuard(...)` calls to passthrough stubs in client-bound bundles (and symmetrically for `defineClientGuard(...)` in server-bound bundles). Server-only helpers referenced only inside a guard body become unreferenced after rewrite and tree-shake out. The runtime filter ALSO skips opposite-env guards, so the stub never executes anyway. Double safety: bundle stripping at build time, chain filtering at runtime.

Same PR: tighten `ActionGuardError.status` from `number` to Hono's `ContentfulStatusCode` and drop the narrow `as 400 | 401 | 403 | 404 | 429 | 500` cast at the response boundary.

Hard cutover. No back-compat shims. Demo has zero guard call sites; only docs reference the old surface.

## Why

Two parallel arrays (`serverGuards`, `clientGuards`) force the user to think about composition twice and lose the ability to express order across environments. The runtime already chose one array or the other based on `isBrowser()`; pulling that choice into a single ordered list removes a concept from the user's head.

`createGuard` was the only `define*`-shaped factory in the framework not named `define*`. Splitting it into `defineServerGuard` / `defineClientGuard` matches the rest of the family AND encodes the environment at definition time, which lets the bundler statically rewrite the call.

The two-factory split is materially better than a single `defineGuard(fn, { runs })` factory because the plugin doesn't have to parse the options literal or check string values. Name-matching is all it needs: same complexity as today's `serverOnlyPlugin` handling of `serverActions`. It also forecloses the dynamic-`runs` case (`defineGuard(fn, { runs: someFlag ? 'server' : 'both' })`) — there's no `runs` argument to be dynamic.

`ActionGuardError`'s status cast at `packages/server/src/actions-handler.ts:133` is a type lie: the constructor accepts any `number` but the response narrows to a hand-picked union. A user passing `418` typechecks but the response cast doesn't. Tightening the constructor closes the gap at the source.

## API Surface

### `GuardFn` is a record built by env-specific factories

```ts
// packages/iso/src/guard.ts

export type GuardRunsOn = 'server' | 'client';

export type GuardContext = { location: RouteHook };

export type GuardResult =
  | { redirect: string }
  | { render: FunctionComponent }
  | void;

export type GuardFn = {
  readonly runs: GuardRunsOn;
  readonly fn: (
    ctx: GuardContext,
    next: () => Promise<GuardResult>,
  ) => Promise<GuardResult>;
};

export const defineServerGuard = (fn: GuardFn['fn']): GuardFn => ({
  runs: 'server',
  fn,
});

export const defineClientGuard = (fn: GuardFn['fn']): GuardFn => ({
  runs: 'client',
  fn,
});
```

The record shape avoids mutating a function with a `.runs` property and the casts that come with it. The factory is the only way to construct a `GuardFn`; bare functions don't satisfy the type, so users get a TS error pointing them at one of the two factories.

`defineGuard` (a single unified factory) and `runs: 'both'` are deliberately not part of the surface. A user who genuinely needs the same logic on both sides writes:

```ts
const checkFlag = (ctx, next) => /* env-agnostic logic */;
guards: [defineServerGuard(checkFlag), defineClientGuard(checkFlag)],
```

The function body is shared; the array is explicit about where it runs.

### `definePage` bindings

```ts
// packages/iso/src/define-page.tsx

export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  guards?: GuardFn[];
};
```

`serverGuards` and `clientGuards` are removed.

### Usage

```tsx
import {
  defineServerGuard,
  defineClientGuard,
  definePage,
} from '@hono-preact/iso';
import { checkAdminFromDb } from './admin.server.js';
import { scrollRestoreFor } from '@/client/scroll.js';

const adminGuard = defineServerGuard(async (ctx, next) => {
  const role = await checkAdminFromDb(ctx);
  if (role !== 'admin') return { redirect: '/forbidden' };
  return next();
});

const scrollRestore = defineClientGuard(async ({ location }, next) => {
  scrollRestoreFor(location.path);
  return next();
});

export default definePage(Admin, { guards: [adminGuard, scrollRestore] });
```

All guards live in the page file (or any module the page file imports). No `.server.ts` `serverGuards` named export is required for tree-shaking; the plugin rewrite handles that (see "Plugin rewrite" below).

### Order semantics

Composition is array order, regardless of environment. Given `[A(server), B(client), C(server), D(client)]`:

- **Server** runs `A → C` (B and D filtered out at runtime, body stripped at build time).
- **Client** runs `B → D` (A and C filtered out at runtime, body stripped at build time).

The runtime filters the array to guards whose `runs` matches the current env, then composes the survivors via `next()`. Skipped guards are absent from the chain, not replaced by passthroughs.

## Runtime

```ts
// packages/iso/src/guard.ts

export const runGuards = async (
  guards: GuardFn[],
  ctx: GuardContext,
): Promise<GuardResult> => {
  const run = async (index: number): Promise<GuardResult> => {
    if (index >= guards.length) return;
    return guards[index].fn(ctx, () => run(index + 1));
  };
  return run(0);
};
```

```tsx
// packages/iso/src/internal/guards.tsx

export const Guards: FunctionComponent<{
  guards?: GuardFn[];
  location: RouteHook;
  fallback?: JSX.Element;
  children: ComponentChildren;
}> = ({ guards = [], location, fallback, children }) => {
  const env: GuardRunsOn = isBrowser() ? 'client' : 'server';
  const active = guards.filter(g => g.runs === env);
  const prevPath = useRef(location.path);
  const guardRef = useRef(wrapPromise(runGuards(active, { location })));
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    guardRef.current = wrapPromise(runGuards(active, { location }));
  }
  return (
    <Suspense fallback={fallback}>
      <GuardConsumer guardRef={guardRef}>{children}</GuardConsumer>
    </Suspense>
  );
};
```

`Page` forwards `guards` as a single prop instead of `serverGuards` / `clientGuards`.

## Plugin rewrite (Vite)

`packages/vite/src/server-only.ts` already knows how to rewrite `serverActions` and the default loader in client-bound files. Extend it with two parallel rules.

**Client bundle rewrite (in any file the browser will load):**

```ts
// Source (the user's page file, browser-bound):
const adminGuard = defineServerGuard(async (ctx, next) => {
  const role = await checkAdminFromDb(ctx);  // server-only import reference
  if (role !== 'admin') return { redirect: '/forbidden' };
  return next();
});

// After client-bundle transform:
const adminGuard = defineServerGuard(__GUARD_NOOP__);
```

Where `__GUARD_NOOP__` is a passthrough stub: `(_ctx, next) => next()`. The original function body is eliminated. Any references inside the body (named imports, local helpers used only there) become unused and tree-shake out under Vite/Rollup's normal pass.

**Server bundle rewrite (in any file SSR will execute):**

Symmetric: `defineClientGuard(fn)` → `defineClientGuard(__GUARD_NOOP__)`.

**Recognition rules:**

- Match the factory by binding name resolved through ESM imports. The plugin tracks `import { defineServerGuard } from '@hono-preact/iso'` and any aliasing (`import { defineServerGuard as dsg }`). Same approach as today's import-name tracking for `serverActions`.
- The rewrite is purely on the call expression: `<factoryName>(<anyExpression>)` → `<factoryName>(<noopRef>)`. The plugin does not inspect or rewrite the body itself; eliminating the call's argument is enough.
- Calls where the argument is a named reference (`defineServerGuard(checkAdmin)`) get the same treatment. The reference is replaced with `__GUARD_NOOP__`; `checkAdmin` becomes unused (assuming it isn't referenced elsewhere) and tree-shakes.

**Documented limitations:**

- The plugin does not rewrite manually-constructed guard records (`{ runs: 'server', fn: async (...) => {...} }`). The type system already prevents this (the `readonly` fields make the record-construction path inconvenient), but for completeness: if a user bypasses the factory, they get the foot-gun. Documented as "use the factories."
- If `defineServerGuard` is re-exported through an indirection (`import { defineServerGuard } from './my-wrapper.js'` where `my-wrapper.ts` re-exports from `@hono-preact/iso`), the plugin's import tracking does not follow the chain. Documented as "import the factories directly from `hono-preact` / `@hono-preact/iso`."

## `ActionGuardError` Status Type Fix

```ts
// packages/iso/src/action.ts
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ActionGuardError extends Error {
  constructor(
    message: string,
    public readonly status: ContentfulStatusCode = 403,
  ) {
    super(message);
    this.name = 'ActionGuardError';
  }
}
```

```ts
// packages/server/src/actions-handler.ts:133
return c.json({ error: err.message }, err.status);   // cast removed
```

```ts
// packages/iso/src/index.ts — re-export for ergonomics
export { ActionGuardError, defineActionGuard } from './action.js';
export type { ContentfulStatusCode } from 'hono/utils/http-status';
```

Users who annotate dynamically:

```ts
import { ActionGuardError, type ContentfulStatusCode } from '@hono-preact/iso';

const status: ContentfulStatusCode = pickStatus();
throw new ActionGuardError('Nope', status);
```

This overrides the v0.1 framework-direction spec line 374 ("status stays `number` end-to-end"). The override is intentional: the narrower type catches the very class of mistake the original cast pretended to handle, and there are no `ActionGuardError` call sites in the demo to migrate.

## Migration

Hard cutover. Old surface is deleted, not deprecated.

### Code

| File | Change |
|---|---|
| `packages/iso/src/guard.ts` | Replace `createGuard` with `defineServerGuard` and `defineClientGuard`. Switch `GuardFn` to record shape. Update `runGuards` to call `guards[i].fn(...)`. |
| `packages/iso/src/define-page.tsx` | `PageBindings.guards` replaces `serverGuards` and `clientGuards`. |
| `packages/iso/src/page.tsx` | `PageProps.guards` replaces the two old props. Forwards to `<Guards>`. |
| `packages/iso/src/internal/guards.tsx` | Single `guards?: GuardFn[]` prop. Filter `g.runs === env`. |
| `packages/iso/src/index.ts` | Export `defineServerGuard`, `defineClientGuard`, `type GuardRunsOn`. Re-export `type ContentfulStatusCode` from `hono/utils/http-status`. Remove `createGuard` export. |
| `packages/iso/src/action.ts` | Narrow `ActionGuardError.status` to `ContentfulStatusCode`. |
| `packages/server/src/actions-handler.ts` | Drop the narrow `as 400 \| 401 \| ...` cast. |
| `packages/vite/src/server-only.ts` | Add `defineServerGuard` / `defineClientGuard` rewrite rules with import-name tracking. Drop the `serverGuards` named-export stub branch (no longer needed; guards live with the page). |
| `packages/vite/src/server-loader-validation.ts` | Remove `serverGuards` from the `.server.*` named-export allowlist. |

### Tests

**Runtime / API:**
- `packages/iso/src/__tests__/page.test.tsx`, `define-page.test.tsx`: migrate `serverGuards` / `clientGuards` tests to the single-list shape. Add:
  - Single-list execution order matches array order.
  - `defineServerGuard` body runs on the server, skipped on the client (runtime filter).
  - `defineClientGuard` body runs on the client, skipped on the server (runtime filter).
  - A compile-only check that plain functions are rejected by `PageBindings.guards`.

**Server action guard:**
- `packages/server/src/__tests__/actions-handler.test.ts`: existing `ActionGuardError` tests pass unchanged; the narrower constructor type is a compile-time concern only.

**Plugin rewrite — these MUST exist to prevent tree-shaking regressions:**
- `packages/vite/src/__tests__/server-only-plugin.test.ts`:
  - `defineServerGuard(async (...) => { return await import('./secret.server.js'); })` in a client-bound source is rewritten so the secret import becomes unreferenced. Assert via plugin `transform` output that the original body is gone and the call's argument is the noop reference.
  - `defineClientGuard(...)` in a server-bound source: same in reverse.
  - `defineServerGuard(extractedHelper)` (named reference) is rewritten the same way; assert the call site no longer references the binding.
  - `defineServerGuard` imported as alias (`import { defineServerGuard as dsg }`) is recognized and rewritten.
  - A manually-constructed `{ runs: 'server', fn: () => {...} }` record is NOT rewritten (acknowledged limitation; document the rule).

**Bundle-content tests — guard against silent regressions in tree-shaking:**
- `packages/vite/src/__tests__/guards-bundle.test.ts` (new file): build a tiny fixture app with `vite build`, assert the produced client bundle:
  - Does NOT contain the body source string of a `defineServerGuard` body or a server-only helper imported only inside one.
  - DOES contain the body source string of a `defineClientGuard` body and a client-only helper imported only inside one.
- The fixture is small (a `Layout.tsx` shell + one page file + one `.server.ts` helper) and lives under `packages/vite/src/__tests__/fixtures/guards-treeshake/`. The test runs `build()` programmatically and reads the emitted JS string.
- Run the symmetric assertion on the server bundle output.

These bundle-content tests are the tripwire: if a future refactor breaks the plugin rewrite or the tree-shake assumption (e.g., adds a stray reference to the rewritten function), the tests fail loudly. Without them, regressions are invisible until a user reports secrets in their bundle.

### Docs

- `apps/app/src/pages/docs/guards.mdx`: rewrite to the single-list shape; replace `createGuard` with `defineServerGuard` and `defineClientGuard`; explain the plugin rewrite (server guard bodies stripped from client bundle; client guard bodies stripped from server bundle); document the "use the factories, not manual records, and import directly from `hono-preact`" pattern that the plugin recognizes.
- `apps/app/src/pages/docs/structure.mdx:60`: update the `definePage` bindings list (drop `serverGuards` / `clientGuards`, add `guards`).
- `apps/app/src/pages/docs/structure.mdx:83`: drop `serverGuards` from the `.server.*` allowlist callout.
- `apps/app/src/pages/docs/loaders.mdx:384`, `loading-states.mdx:83`: same surface update.
- `apps/app/src/pages/docs/action-guards.mdx`: update the `ActionGuardError` constructor signature and the `ContentfulStatusCode` import note. Note that `actionGuards` (the `.server.*` named export for action guards) is unchanged.

### Spec edit

- `docs/superpowers/specs/2026-05-09-v0.1-framework-direction.md` section 7: replace the sketch with the final API decisions (`defineServerGuard` / `defineClientGuard`, no `'both'`, plugin rewrite for body stripping, `ContentfulStatusCode` for `ActionGuardError`).

## Out of Scope

- **Merging page guards with action guards.** Separate investigation (GitHub issue #33). The contexts differ (`{ location }` vs `{ c, module, action, payload }`) and the result types differ (page guards can `redirect` or `render`; action guards can only pass or throw).
- **Layout-level guards in `defineRoutes`.** `definePage` is the surface; layout routes do not carry guards at v0.1.
- **Runtime back-compat for `serverGuards` / `clientGuards`.** Deleted, not deprecated.
- **`createGuard` alias.** Deleted, not aliased.
- **`defineGuard` unified factory.** Not part of the surface. Two factories, one per env.
- **`.server.ts` `serverGuards` named export.** Removed from the plugin allowlist; the plugin rewrite makes the file-level export redundant.
