# `use` Entry Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an unclassifiable `use` entry throw at construction instead of being silently reclassified as a stream observer, which today turns a malformed auth gate into a middleware that never runs.

**Architecture:** A new `packages/iso/src/internal/use-entry.ts` owns the classification contract (`isMiddleware`, `isObserver`, `assertUseEntry`). `partitionUse` widens its parameter to `ReadonlyArray<unknown>`, validates every entry through those predicates, and throws on the first failure, so all four of its callers fail closed without changes. `server-caller.ts`, which hand-rolls its own filter rather than calling `partitionUse`, adopts the same predicates.

**Tech Stack:** TypeScript (strict), vitest, pnpm workspaces. Packages touched: `@hono-preact/iso`, `@hono-preact/server`, `apps/site` (docs).

**Spec:** `docs/superpowers/specs/2026-07-21-use-entry-validation-design.md`

**Issue:** #321 (milestone v0.13, execution rank 01)

## Global Constraints

- **No em-dashes** in prose, code comments, or commit messages. Use `--`, a comma, a semicolon, parentheses, or two sentences. This repo's existing error messages use `--` (see `packages/iso/src/define-channel.ts:109-160`).
- **No inline type casts** where a reshape works (CLAUDE.md "Type casts"). This plan *removes* three casts; do not add new ones.
- **Working directory is the worktree:** `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/use-entry-validation-321`. All paths below are relative to it. Do not `cd` to the primary checkout. Use worktree-prefixed absolute paths with Read/Edit/Write.
- **Do not use Serena's symbol/edit tools.** Serena binds to the primary checkout; an edit would land in the wrong tree. Use `rg`/Read/Edit.
- **`pnpm --filter <pkg> test` is a silent no-op** (sub-packages have no `test` script; it exits 0 having run nothing). Always run `pnpm exec vitest run <pattern>` from the repo root.
- **Test files are excluded from `tsc`.** Both `packages/iso/tsconfig.json` and `packages/server/tsconfig.json` exclude `src/**/__tests__/**`, so `pnpm typecheck` will not catch a type error in a test file. Vitest strips types, so it will not either. Read test code carefully rather than trusting a green typecheck.
- **Cross-package types resolve through built `dist/`.** After changing a signature in `@hono-preact/iso`, run the framework build before `pnpm typecheck`, or `packages/server` and `apps/site` will report stale "missing export" errors.
- **Commit after every task.** Never `git push`, never `--force`, and do not open a PR until the final task's verification passes.
- **The error message's closing sentence is fixed copy**, used verbatim everywhere it appears in this plan:
  `A \`use\` entry the framework cannot classify would be silently dropped from the middleware chain -- if this is an auth gate, it would not run.`

---

### Task 1: The `use-entry` classification module

**Files:**
- Create: `packages/iso/src/internal/use-entry.ts`
- Test: `packages/iso/src/internal/__tests__/use-entry.test.ts`

**Interfaces:**
- Consumes: `Middleware` from `packages/iso/src/define-middleware.ts`, `StreamObserver` from `packages/iso/src/define-stream-observer.ts`.
- Produces, relied on by Tasks 2 and 4:
  - `type AnyObserver = StreamObserver<unknown, never>`
  - `type UseEntry = Middleware | AnyObserver`
  - `function isMiddleware(entry: unknown): entry is Middleware`
  - `function isObserver(entry: unknown): entry is AnyObserver`
  - `function assertUseEntry(entry: unknown, index: number, source?: string): asserts entry is UseEntry`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/use-entry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isMiddleware, isObserver, assertUseEntry } from '../use-entry.js';
import {
  defineServerMiddleware,
  defineClientMiddleware,
} from '../../define-middleware.js';
import { defineStreamObserver } from '../../define-stream-observer.js';

const noop = async (_c: never, next: () => Promise<unknown>) => {
  await next();
};

describe('isMiddleware', () => {
  it('accepts what the define* factories produce', () => {
    expect(isMiddleware(defineServerMiddleware(noop))).toBe(true);
    expect(isMiddleware(defineClientMiddleware(noop))).toBe(true);
  });

  it('accepts the build-time guard-strip replacement literals', () => {
    // packages/vite/src/guard-strip.ts inlines these into the wrong-env
    // bundle in place of a stripped defineServerMiddleware/
    // defineClientMiddleware call. They must stay classifiable.
    expect(
      isMiddleware({
        __kind: 'middleware',
        runs: 'client',
        fn: (_ctx: unknown, next: () => unknown) => next(),
      })
    ).toBe(true);
    expect(
      isMiddleware({
        __kind: 'middleware',
        runs: 'server',
        fn: (_ctx: unknown, next: () => unknown) => next(),
      })
    ).toBe(true);
  });

  it('rejects a bad `runs`, so a typo cannot survive into the runs filter', () => {
    expect(isMiddleware({ __kind: 'middleware', runs: 'sever', fn: noop })).toBe(
      false
    );
    expect(isMiddleware({ __kind: 'middleware', fn: noop })).toBe(false);
  });

  it('rejects a missing or non-function `fn`', () => {
    expect(isMiddleware({ __kind: 'middleware', runs: 'server' })).toBe(false);
    expect(
      isMiddleware({ __kind: 'middleware', runs: 'server', fn: 'guard' })
    ).toBe(false);
  });

  it('rejects observers, non-objects, and a missing brand', () => {
    expect(isMiddleware(defineStreamObserver({}))).toBe(false);
    expect(isMiddleware(null)).toBe(false);
    expect(isMiddleware(undefined)).toBe(false);
    expect(isMiddleware(noop)).toBe(false);
    expect(isMiddleware('guard')).toBe(false);
    expect(isMiddleware({ fn: noop })).toBe(false);
  });
});

describe('isObserver', () => {
  it('accepts what defineStreamObserver produces, with and without hooks', () => {
    expect(isObserver(defineStreamObserver({}))).toBe(true);
    expect(isObserver(defineStreamObserver({ onStart: () => {} }))).toBe(true);
    expect(
      isObserver(
        defineStreamObserver({
          onStart: () => {},
          onChunk: () => {},
          onEnd: () => {},
          onError: () => {},
          onAbort: () => {},
        })
      )
    ).toBe(true);
  });

  it('accepts the bare guard-strip replacement literal', () => {
    // guard-strip.ts replaces a stripped defineStreamObserver() call with
    // exactly `{ __kind: 'observer' }` in the client bundle.
    expect(isObserver({ __kind: 'observer' })).toBe(true);
  });

  it('rejects a present hook that is not a function', () => {
    expect(isObserver({ __kind: 'observer', onChunk: 3 })).toBe(false);
    expect(isObserver({ __kind: 'observer', onStart: null })).toBe(false);
  });

  it('rejects middleware, non-objects, and a missing brand', () => {
    expect(isObserver(defineServerMiddleware(noop))).toBe(false);
    expect(isObserver(null)).toBe(false);
    expect(isObserver(undefined)).toBe(false);
    expect(isObserver(noop)).toBe(false);
    expect(isObserver({ onChunk: () => {} })).toBe(false);
  });
});

describe('assertUseEntry', () => {
  it('passes valid middleware and observers through', () => {
    expect(() => assertUseEntry(defineServerMiddleware(noop), 0)).not.toThrow();
    expect(() => assertUseEntry(defineStreamObserver({}), 0)).not.toThrow();
  });

  it('names the index and the source label', () => {
    expect(() =>
      assertUseEntry({ __kind: 'middlware' }, 2, 'the app-level `use`')
    ).toThrow(/Invalid `use` entry at index 2 of the app-level `use`:/);
  });

  it('omits the source clause when no label is given', () => {
    expect(() => assertUseEntry({ __kind: 'middlware' }, 0)).toThrow(
      /^Invalid `use` entry at index 0: /
    );
  });

  it('always explains why a silent drop matters', () => {
    expect(() => assertUseEntry(null, 0)).toThrow(
      /would be silently dropped from the middleware chain -- if this is an auth gate, it would not run\.$/
    );
  });

  it('diagnoses a middleware with a bad `runs`', () => {
    expect(() =>
      assertUseEntry({ __kind: 'middleware', runs: 'sever', fn: noop }, 0)
    ).toThrow(
      /a middleware whose `runs` is "sever" \(expected 'server' or 'client'\)/
    );
  });

  it('diagnoses a middleware with a bad `fn`', () => {
    expect(() =>
      assertUseEntry({ __kind: 'middleware', runs: 'server' }, 0)
    ).toThrow(/a middleware whose `fn` is not a function \(undefined\)/);
  });

  it('diagnoses an observer with a bad hook', () => {
    expect(() =>
      assertUseEntry({ __kind: 'observer', onChunk: 3 }, 0)
    ).toThrow(/an observer whose `onChunk` is not a function \(number\)/);
  });

  it('diagnoses an unknown __kind', () => {
    expect(() => assertUseEntry({ __kind: 'middlware' }, 0)).toThrow(
      /an object with `__kind` "middlware" \(expected 'middleware' or 'observer'\)/
    );
  });

  it('diagnoses an object with no __kind', () => {
    expect(() => assertUseEntry({ fn: noop }, 0)).toThrow(
      /an object with no `__kind`/
    );
  });

  it('diagnoses non-objects', () => {
    expect(() => assertUseEntry(null, 0)).toThrow(/: null\. A `use` entry/);
    expect(() => assertUseEntry(undefined, 0)).toThrow(
      /: undefined\. A `use` entry/
    );
    expect(() => assertUseEntry(noop, 0)).toThrow(/: a function\. A `use`/);
    expect(() => assertUseEntry('guard', 0)).toThrow(
      /: a string \("guard"\)\. A `use`/
    );
    expect(() => assertUseEntry(7, 0)).toThrow(/: a number \(7\)\. A `use`/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run packages/iso/src/internal/__tests__/use-entry.test.ts
```

Expected: FAIL. Vitest cannot resolve `../use-entry.js` (the module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/iso/src/internal/use-entry.ts`:

```ts
import type { Middleware } from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';

// `StreamObserver<TChunk, TResult>` is invariant in `TResult` (it appears
// in callback arg positions, e.g. `onEnd({ result: TResult })`), so any
// concrete instantiation we declare here would reject sibling observers
// with a different TResult. Classification only reads `__kind` and the
// hook shapes, so we accept the broadest structural form.
export type AnyObserver = StreamObserver<unknown, never>;
export type UseEntry = Middleware | AnyObserver;

const OBSERVER_HOOKS = [
  'onStart',
  'onChunk',
  'onEnd',
  'onError',
  'onAbort',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A `use` entry is middleware when it carries the full Middleware contract,
 * not merely the `__kind` brand. `runs` and `fn` are part of the check on
 * purpose: every consumer filters `runs === 'server'` after partitioning, so
 * a typo'd `runs` that passed a brand-only check would still be dropped from
 * the server chain, which is the same fail-open this validation exists to
 * close. A non-function `fn` would otherwise surface as an opaque TypeError
 * from inside the dispatcher.
 */
export function isMiddleware(entry: unknown): entry is Middleware {
  return (
    isRecord(entry) &&
    entry.__kind === 'middleware' &&
    (entry.runs === 'server' || entry.runs === 'client') &&
    typeof entry.fn === 'function'
  );
}

/**
 * Every observer hook is optional, so a hookless `{ __kind: 'observer' }` is
 * valid: that is exactly what `packages/vite/src/guard-strip.ts` inlines in
 * place of a stripped `defineStreamObserver()` call. Hooks that ARE present
 * must be callable, mirroring the `fn` check on middleware.
 */
export function isObserver(entry: unknown): entry is AnyObserver {
  if (!isRecord(entry) || entry.__kind !== 'observer') return false;
  return OBSERVER_HOOKS.every(
    (hook) => entry[hook] === undefined || typeof entry[hook] === 'function'
  );
}

/** Human-readable diagnosis of why an entry is unclassifiable. */
function describeEntry(entry: unknown): string {
  if (entry === null) return 'null';
  if (entry === undefined) return 'undefined';
  if (typeof entry === 'function') return 'a function';
  if (!isRecord(entry)) {
    const rendered = typeof entry === 'string' ? `"${entry}"` : String(entry);
    return `a ${typeof entry} (${rendered})`;
  }
  if (entry.__kind === 'middleware') {
    if (entry.runs !== 'server' && entry.runs !== 'client') {
      return `a middleware whose \`runs\` is ${JSON.stringify(entry.runs)} (expected 'server' or 'client')`;
    }
    return `a middleware whose \`fn\` is not a function (${typeof entry.fn})`;
  }
  if (entry.__kind === 'observer') {
    const bad = OBSERVER_HOOKS.find(
      (hook) => entry[hook] !== undefined && typeof entry[hook] !== 'function'
    );
    // `bad` is always found here: isObserver only rejects an `observer` for a
    // non-callable hook. The guard keeps the read typed without a cast.
    if (bad === undefined) return 'an observer the framework cannot classify';
    return `an observer whose \`${bad}\` is not a function (${typeof entry[bad]})`;
  }
  if (entry.__kind === undefined) return 'an object with no `__kind`';
  return `an object with \`__kind\` ${JSON.stringify(entry.__kind)} (expected 'middleware' or 'observer')`;
}

/**
 * Fail closed at the classification boundary. `use` arrays are read
 * structurally off user-defined modules, so an entry the framework cannot
 * classify used to fall through to the observer bucket, and observers do not
 * gate: a malformed auth middleware became a gate that never ran, with no
 * second gate behind it.
 *
 * `source` names the layer the entry came from (e.g. "the app-level `use`"),
 * so `index` locates it in a specific array rather than in a merged chain.
 */
export function assertUseEntry(
  entry: unknown,
  index: number,
  source?: string
): asserts entry is UseEntry {
  if (isMiddleware(entry) || isObserver(entry)) return;
  const where = source ? ` of ${source}` : '';
  throw new Error(
    `Invalid \`use\` entry at index ${index}${where}: ${describeEntry(entry)}. ` +
      'A `use` entry the framework cannot classify would be silently dropped ' +
      'from the middleware chain -- if this is an auth gate, it would not run.'
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run packages/iso/src/internal/__tests__/use-entry.test.ts
```

Expected: PASS, 20 tests.

If the "diagnoses non-objects" case fails on `String(entry)` for a symbol, note that `String(Symbol())` is legal (unlike template interpolation) and the test does not cover symbols; leave it as written.

- [ ] **Step 5: Typecheck the package**

```bash
pnpm --filter @hono-preact/iso exec tsc --noEmit
```

Expected: no output (exit 0). Note the `entry[bad as string]` read in `describeEntry`: `bad` is narrowed to the hook-name union, and indexing a `Record<string, unknown>` with it is fine, so no cast beyond that index expression is needed.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/use-entry.ts packages/iso/src/internal/__tests__/use-entry.test.ts
git commit -m "feat(iso): add use-entry classification predicates

isMiddleware verifies the whole Middleware contract (__kind, runs, fn), not
just the brand: every consumer filters runs === 'server' after partitioning,
so a typo'd runs that passed a brand-only check would still be silently
dropped from the server chain.

isObserver allows a hookless { __kind: 'observer' }, which is what
guard-strip.ts inlines for a stripped defineStreamObserver call, but requires
any hook that IS present to be callable.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Validate inside `partitionUse` and drop the caller casts

**Files:**
- Modify: `packages/iso/src/internal/use-partitioner.ts` (whole file rewritten)
- Modify: `packages/iso/src/internal/__tests__/use-partitioner.test.ts`
- Modify: `packages/server/src/render.tsx:7` (drop the `Middleware` type import), `packages/server/src/render.tsx:139-141` (drop the cast)
- Modify: `packages/iso/src/internal/loader-runner-server.ts:6-10` (drop the `Middleware` type import), `packages/iso/src/internal/loader-runner-server.ts:78-80` (drop the cast)

**Interfaces:**
- Consumes: `isMiddleware`, `isObserver`, `assertUseEntry`, `AnyObserver` from Task 1's `./use-entry.js`.
- Produces, relied on by Task 3:
  `partitionUse(use: ReadonlyArray<unknown>, source?: string): { middleware: Middleware[]; observers: AnyObserver[] }`

`packages/iso/src/internal/page-middleware-host.tsx:46` calls `partitionUse(use)` where `use` is already `ReadonlyArray<UseEntry>`. Widening the parameter accepts that unchanged, so **that file needs no edit**.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `packages/iso/src/internal/__tests__/use-partitioner.test.ts` with:

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

  it('throws on an entry it cannot classify instead of bucketing it as an observer', () => {
    // The fail-open this validation closes: a malformed middleware used to
    // land in the observer bucket, and observers cannot deny.
    expect(() => partitionUse([{ __kind: 'middlware' }])).toThrow(
      /Invalid `use` entry at index 0: an object with `__kind` "middlware"/
    );
  });

  it('throws on a middleware whose `runs` would fail the server filter', () => {
    expect(() =>
      partitionUse([{ __kind: 'middleware', runs: 'sever', fn: () => {} }])
    ).toThrow(/a middleware whose `runs` is "sever"/);
  });

  it('throws on a middleware with no `fn`', () => {
    expect(() =>
      partitionUse([{ __kind: 'middleware', runs: 'server' }])
    ).toThrow(/a middleware whose `fn` is not a function \(undefined\)/);
  });

  it('throws on null, undefined, and a bare function', () => {
    expect(() => partitionUse([null])).toThrow(/: null\./);
    expect(() => partitionUse([undefined])).toThrow(/: undefined\./);
    expect(() => partitionUse([() => {}])).toThrow(/: a function\./);
  });

  it('reports the position of a bad entry that is not first, and the source label', () => {
    const mw = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const obs = defineStreamObserver({});
    expect(() =>
      partitionUse([mw, obs, null], 'the app-level `use`')
    ).toThrow(/Invalid `use` entry at index 2 of the app-level `use`: null\./);
  });

  it('rejects a bad entry even when valid middleware follows it', () => {
    const mw = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    expect(() => partitionUse([null, mw])).toThrow(/index 0/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vitest run packages/iso/src/internal/__tests__/use-partitioner.test.ts
```

Expected: the two original tests PASS; the six new tests FAIL. The classification tests fail with "expected [Function] to throw an error" (entries are still bucketed, not rejected). TypeScript errors in the test file do not stop vitest, which strips types.

- [ ] **Step 3: Rewrite the partitioner**

Replace the whole of `packages/iso/src/internal/use-partitioner.ts` with:

```ts
import type { Middleware } from '../define-middleware.js';
import {
  assertUseEntry,
  isMiddleware,
  type AnyObserver,
} from './use-entry.js';

/**
 * Split a `use` array into middleware and stream observers.
 *
 * Takes `ReadonlyArray<unknown>` because that is how the data genuinely
 * arrives: page-level and unit-level `use` are structural reads off
 * user-defined modules. Callers used to cast into a typed array to get in
 * here, and the cast was exactly what let a malformed entry through. The
 * runtime check is now the single source of truth for this boundary, and
 * the predicates do the narrowing.
 *
 * `source` labels the layer in the error message (e.g. "the app-level
 * `use`"); pass it wherever the caller knows which array it holds.
 */
export function partitionUse(
  use: ReadonlyArray<unknown>,
  source?: string
): {
  middleware: Middleware[];
  observers: AnyObserver[];
} {
  const middleware: Middleware[] = [];
  const observers: AnyObserver[] = [];
  for (let index = 0; index < use.length; index++) {
    const entry = use[index];
    assertUseEntry(entry, index, source);
    if (isMiddleware(entry)) middleware.push(entry);
    else observers.push(entry);
  }
  return { middleware, observers };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run packages/iso/src/internal/__tests__/use-partitioner.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Drop the now-dead cast in the SSR loader runner**

In `packages/iso/src/internal/loader-runner-server.ts`, the type import at lines 6-10 currently reads:

```ts
import type {
  ServerMiddleware,
  ServerLoaderCtx,
  Middleware,
} from '../define-middleware.js';
```

Change it to (drop `Middleware`, which becomes unused):

```ts
import type {
  ServerMiddleware,
  ServerLoaderCtx,
} from '../define-middleware.js';
```

At lines 78-80, change:

```ts
  const { middleware: allMiddleware, observers } = partitionUse(
    (loaderRef.use ?? []) as ReadonlyArray<Middleware>
  );
```

to:

```ts
  const { middleware: allMiddleware, observers } = partitionUse(
    loaderRef.use ?? [],
    `the \`use\` on loader ${loaderRef.__moduleKey ?? '<unkeyed>'}`
  );
```

- [ ] **Step 6: Drop the now-dead cast in the root SSR render**

In `packages/server/src/render.tsx`, delete the line `  type Middleware,` from the `@hono-preact/iso` import block (line 7); it becomes unused.

At lines 139-143, change:

```ts
        const rootUse = options?.appConfig?.use ?? [];
        const serverMw = partitionUse(
          rootUse as ReadonlyArray<Middleware>
        ).middleware.filter(
          (m): m is ServerMiddleware<'page'> => m.runs === 'server'
        );
```

to:

```ts
        const rootUse = options?.appConfig?.use ?? [];
        const serverMw = partitionUse(
          rootUse,
          'the app-level `use`'
        ).middleware.filter(
          (m): m is ServerMiddleware<'page'> => m.runs === 'server'
        );
```

- [ ] **Step 7: Build the framework, then typecheck**

`packages/server` resolves `@hono-preact/iso` types through the built `dist/`, so the build must run first or the widened signature will not be visible.

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm typecheck
```

Expected: build succeeds; typecheck produces no errors. If `render.tsx` reports `'Middleware' is declared but never used`, the Step 6 import deletion was missed.

- [ ] **Step 8: Run the iso and server suites**

```bash
pnpm exec vitest run packages/iso packages/server
```

Expected: PASS. Watch specifically for `packages/iso/src/__tests__/define-loader-use.test.tsx`, `define-action-use.test.ts`, and `packages/server/src/__tests__/` regressions: any failure here means an existing fixture builds a `use` entry by hand that the stricter predicates now reject. If that happens, read the fixture. A fixture missing `runs` or `fn` should be fixed to a real entry (that is the bug the check exists to catch), not worked around by loosening the predicate.

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/internal/use-partitioner.ts packages/iso/src/internal/__tests__/use-partitioner.test.ts packages/iso/src/internal/loader-runner-server.ts packages/server/src/render.tsx
git commit -m "fix(iso): throw on an unclassifiable use entry instead of bucketing it

partitionUse classified by exclusion, so anything that was not
__kind: 'middleware' fell through to the observer bucket. Observers cannot
deny, so a malformed auth middleware became a gate that never ran, with no
second gate behind it.

Widening the parameter to ReadonlyArray<unknown> deletes the casts at
render.tsx and loader-runner-server.ts that laundered untyped user-module
reads into the typed signature; those casts were what let a malformed entry
in. The runtime check is now the boundary's single source of truth.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Per-layer partitioning in `composeServerChain`

**Files:**
- Modify: `packages/server/src/compose-server-chain.ts:1-8` (imports), `:82-94` (composition)
- Test: `packages/server/src/__tests__/compose-server-chain.test.ts` (append cases)

**Interfaces:**
- Consumes: `partitionUse(use, source?)` from Task 2.
- Produces: no signature change. `ComposedServerChain` is unchanged; `serverMw` and `observers` keep their existing order.

Partitioning each layer separately and concatenating yields byte-identical output to partitioning the merged array: partitioning preserves relative order within each bucket, and the layers concatenate in the same outer -> inner order either way. The gain is a meaningful index in the error, since "index 4" of a merged three-layer chain locates nothing.

- [ ] **Step 1: Write the failing tests**

First extend the existing import at the top of `packages/server/src/__tests__/compose-server-chain.test.ts` so the `AppConfig` type is available:

```ts
import {
  defineServerMiddleware,
  defineClientMiddleware,
  defineStreamObserver,
  type AppConfig,
} from '@hono-preact/iso';
```

Then append to the existing `describe('composeServerChain', ...)` block:

```ts
  it('names the app layer and a layer-relative index for a bad app-level entry', async () => {
    const ok = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    // AppConfig['use'] cannot express an invalid entry, which is the point of
    // the test; go through `unknown` to build one.
    const appConfig = { use: [ok, null] } as unknown as AppConfig;
    await expect(
      composeServerChain<'action'>({ ...baseArgs, appConfig })
    ).rejects.toThrow(
      /Invalid `use` entry at index 1 of the app-level `use`: null\./
    );
  });

  it('names the page layer and its own path for a bad page-level entry', async () => {
    await expect(
      composeServerChain<'action'>({
        ...baseArgs,
        path: '/admin/:id',
        resolvePageUse: async () => [{ __kind: 'middlware' }],
      })
    ).rejects.toThrow(
      /Invalid `use` entry at index 0 of the page `use` for \/admin\/:id: an object with `__kind` "middlware"/
    );
  });

  it("names the unit layer, indexed within the unit's own use", async () => {
    const ok = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    await expect(
      composeServerChain<'action'>({
        ...baseArgs,
        appConfig: { use: [ok] },
        resolvePageUse: async () => [ok],
        // Index 0 within the unit layer, which would be index 2 of the
        // merged chain: the layer-relative index is the point.
        unitUse: [{ __kind: 'middleware', runs: 'server' }],
      })
    ).rejects.toThrow(
      /Invalid `use` entry at index 0 of the unit's own `use`: a middleware whose `fn` is not a function \(undefined\)/
    );
  });

  it('keeps [app, page, unit] order when every layer is partitioned separately', async () => {
    const appMw = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const appObs = defineStreamObserver({ onStart: () => {} });
    const pageMw = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const unitObs = defineStreamObserver({ onEnd: () => {} });
    const unitMw = defineServerMiddleware<'action'>(async (_c, n) => {
      await n();
    });
    const { serverMw, observers } = await composeServerChain<'action'>({
      ...baseArgs,
      appConfig: { use: [appMw, appObs] },
      resolvePageUse: async () => [pageMw],
      unitUse: [unitObs, unitMw],
    });
    expect(serverMw).toEqual([appMw, pageMw, unitMw]);
    expect(observers).toEqual([appObs, unitObs]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vitest run packages/server/src/__tests__/compose-server-chain.test.ts
```

Expected: the three error-message tests FAIL (the message says `at index 1:` with no source clause, because `partitionUse` is still called once on the merged array). The order test PASSES already, which is the point: it is the regression guard for the refactor.

- [ ] **Step 3: Partition per layer**

In `packages/server/src/compose-server-chain.ts`, the import block at lines 1-8 currently reads:

```ts
import type {
  AppConfig,
  Middleware,
  ServerMiddleware,
  StreamObserver,
  Scope,
} from '@hono-preact/iso';
import { partitionUse } from '@hono-preact/iso/internal';
```

Change it to (drop `Middleware`, which becomes unused; `StreamObserver` is still used at line 33):

```ts
import type {
  AppConfig,
  ServerMiddleware,
  StreamObserver,
  Scope,
} from '@hono-preact/iso';
import { partitionUse } from '@hono-preact/iso/internal';
```

Then replace lines 82-94:

```ts
  // Chain order is outer -> inner: app-level wraps every request, page-level
  // wraps the route's units, and the unit's own `use` wraps just this call.
  const rootUse = appConfig?.use ?? [];
  const pageUse = await resolvePageUse(path);
  const fullUse: ReadonlyArray<Middleware | StreamObserver<unknown, never>> = [
    ...rootUse,
    ...pageUse,
    ...unitUse,
  ] as ReadonlyArray<Middleware | StreamObserver<unknown, never>>;
  const { middleware: allMiddleware, observers } = partitionUse(fullUse);
  const serverMw = allMiddleware.filter(
    (m): m is ServerMiddleware<S> => m.runs === 'server'
  );
```

with:

```ts
  // Chain order is outer -> inner: app-level wraps every request, page-level
  // wraps the route's units, and the unit's own `use` wraps just this call.
  // Each layer is partitioned on its own so a rejected entry reports which
  // `use` array it came from and its index WITHIN that array; concatenating
  // the three results is identical to partitioning the merged chain, since
  // partitioning preserves relative order within each bucket.
  const root = partitionUse(appConfig?.use ?? [], 'the app-level `use`');
  const page = partitionUse(
    await resolvePageUse(path),
    `the page \`use\` for ${path}`
  );
  const unit = partitionUse(unitUse, "the unit's own `use`");

  const allMiddleware = [
    ...root.middleware,
    ...page.middleware,
    ...unit.middleware,
  ];
  const observers = [...root.observers, ...page.observers, ...unit.observers];
  const serverMw = allMiddleware.filter(
    (m): m is ServerMiddleware<S> => m.runs === 'server'
  );
```

Also update the JSDoc on `composeServerChain` at lines 47-54, which describes the removed cast. Replace this sentence:

```
 * ordering, the timeout-derivation rule, and the single `ReadonlyArray<unknown>`
 * -> typed-element cast in one place. The cast sits at the structural-read
 * boundary: page-level `use` and a unit's `use` are read off user-defined
 * modules as `ReadonlyArray<unknown>`, so the concatenation infers `unknown[]`;
 * we assert the known element type here, the one point the chain re-enters
 * typed land. The `runs === 'server'` predicate narrows to the caller's scope
 * `S` (the chain only carries that scope's middleware by construction).
```

with:

```
 * ordering and the timeout-derivation rule in one place. Page-level `use` and
 * a unit's `use` are structural reads off user-defined modules, so they enter
 * as `ReadonlyArray<unknown>`; `partitionUse` validates every entry and its
 * predicates are what return the chain to typed land. The `runs === 'server'`
 * predicate narrows to the caller's scope `S` (the chain only carries that
 * scope's middleware by construction).
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run packages/server/src/__tests__/compose-server-chain.test.ts
```

Expected: PASS. All pre-existing cases in the file must still pass, especially "composes [app, page, unit] server middleware in outer->inner order" and "keeps only runs===server middleware and partitions observers out".

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors. (No `@hono-preact/iso` sources changed in this task, so no rebuild is needed.)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/compose-server-chain.ts packages/server/src/__tests__/compose-server-chain.test.ts
git commit -m "fix(server): partition each use layer separately for locatable errors

An index into the merged [app, page, unit] chain does not tell anyone which
use array to look in. Partitioning per layer and concatenating gives the same
output order (partitioning preserves relative order within each bucket) while
letting the error name the layer and a layer-relative index.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The second silent-drop site in `server-caller.ts`

**Files:**
- Modify: `packages/iso/src/server-caller.ts:80-101`
- Test: `packages/iso/src/__tests__/server-caller.test.ts` (append one case)

**Interfaces:**
- Consumes: `assertUseEntry`, `isMiddleware` from Task 1's `./internal/use-entry.js`.
- Produces: no exported signature change. The internal helper becomes `serverMiddleware(use: ReadonlyArray<unknown> | undefined): ReadonlyArray<ServerMiddleware>`.

This site never called `partitionUse`; it hand-rolls `__kind === 'middleware' && runs === 'server'` and discards everything else without comment, so the in-process `ctx.call()` path drops malformed entries too. Dropping a *valid* client middleware or observer here stays correct: `call()` runs neither.

- [ ] **Step 1: Write the failing test**

First extend the existing middleware import at the top of `packages/iso/src/__tests__/server-caller.test.ts`:

```ts
import {
  defineServerMiddleware,
  type ServerMiddleware,
} from '../define-middleware.js';
```

Then append inside the same `describe` block that holds "calls an action with a payload and runs its own middleware":

```ts
  it('throws on an unclassifiable entry in an action `use` rather than dropping it', async () => {
    const c = await ctx();
    // A guard that lost its `runs`. The `use` option cannot express one, which
    // is the point of the test, so go through `unknown` to build it.
    const malformed = {
      __kind: 'middleware',
      fn: async () => deny('FORBIDDEN'),
    } as unknown as ServerMiddleware;
    const act = defineAction(
      async (_c, p: { x: number }) => ({ doubled: p.x * 2 }),
      { use: [malformed] }
    );
    await expect(createCaller(c).call(act, { x: 21 })).rejects.toThrow(
      /Invalid `use` entry at index 0 of the action's own `use`: a middleware whose `runs` is undefined \(expected 'server' or 'client'\)/
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run packages/iso/src/__tests__/server-caller.test.ts
```

Expected: FAIL. The call resolves `{ ok: true, value: { doubled: 42 } }` (the malformed guard was dropped and the action ran) instead of rejecting, so vitest reports the promise resolved rather than rejected.

- [ ] **Step 3: Adopt the shared predicates**

In `packages/iso/src/server-caller.ts`, add to the imports (after the existing `./internal/...` imports, near line 10):

```ts
import { assertUseEntry, isMiddleware } from './internal/use-entry.js';
```

Then change `ServerActionView`'s `use` field at line 85 from:

```ts
  use?: ReadonlyArray<{ __kind: string; runs?: string }>;
```

to:

```ts
  use?: ReadonlyArray<unknown>;
```

and replace `serverMiddleware` at lines 91-101:

```ts
function serverMiddleware(
  use: ReadonlyArray<{ __kind: string; runs?: string }> | undefined
): ReadonlyArray<ServerMiddleware> {
  const out: ServerMiddleware[] = [];
  for (const entry of use ?? []) {
    if (entry.__kind === 'middleware' && entry.runs === 'server') {
      out.push(entry as ServerMiddleware);
    }
  }
  return out;
}
```

with:

```ts
// The in-process `call()` path runs server middleware only: it has no client
// leg and no streaming pump, so a valid client middleware or observer is
// correctly skipped. What must NOT be skipped is an entry the framework
// cannot classify -- silently discarding one here is the same fail-open
// partitionUse closes, so validate before filtering.
function serverMiddleware(
  use: ReadonlyArray<unknown> | undefined
): ReadonlyArray<ServerMiddleware> {
  const entries = use ?? [];
  const out: ServerMiddleware[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    assertUseEntry(entry, index, "the action's own `use`");
    if (isMiddleware(entry) && entry.runs === 'server') out.push(entry);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run packages/iso/src/__tests__/server-caller.test.ts
```

Expected: PASS, including the pre-existing "calls an action with a payload and runs its own middleware" case (its hand-built guard at line 63 has `__kind`, `runs`, and `fn`, so it stays valid).

- [ ] **Step 5: Rebuild and typecheck**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm typecheck
```

Expected: build succeeds; typecheck produces no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/server-caller.ts packages/iso/src/__tests__/server-caller.test.ts
git commit -m "fix(iso): validate action use entries on the in-process call path

server-caller.ts never called partitionUse; it hand-rolled the
__kind + runs filter and discarded everything else without comment, so
ctx.call() silently dropped malformed entries even after partitionUse
started rejecting them. Same predicates, same failure mode closed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Docs sync and full pre-push verification

**Files:**
- Modify: `apps/site/src/pages/docs/middleware.mdx:255-263`

**Interfaces:**
- Consumes: everything from Tasks 1-4. Produces nothing consumed downstream.

`REVIEW.md` requires docs sync for a behavior change. The "The `use` array" section currently says the dispatcher "partitions into middleware and stream observers" without saying what happens to an entry that is neither, which is now an error.

- [ ] **Step 1: Update the docs**

In `apps/site/src/pages/docs/middleware.mdx`, after the paragraph at line 263 (the one beginning "Ordering matters for middleware:"), insert a blank line and then:

```mdx
Every entry has to be one of those two. The framework checks each one as it builds the chain, and an entry it cannot classify (a wrong import, a hand-rolled object missing `runs` or `fn`) throws with the array and index that hold it. It is deliberately loud: the alternative is a malformed guard quietly sitting in the observer bucket, where nothing it does can deny.
```

Follow `BRAND.md` voice. Do not add "formerly", "now", or any other historical framing (see the docs-style rule: describe what is).

- [ ] **Step 2: Run the full CI sequence**

Run all eight steps in order, from the worktree root. Do not skip any.

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

Expected: every command exits 0. If `format:check` fails, run `pnpm format`, then re-run `format:check` and include the reformatted files in the commit. Report any failure with its actual output rather than retrying blind.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/docs/middleware.mdx
git commit -m "docs: say what happens to a use entry that is neither kind

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Report, do not push**

Summarize for the user: the five commits, the verification output, and the one behavior change to carry into the v0.13 release notes (`partitionUse`, exported from the `hono-preact/internal` escape-hatch surface, now throws where it previously tolerated any entry). Wait for explicit instruction before `git push` or `gh pr create`.

---

## Notes for the reviewer

- **No public API change.** `partitionUse`'s parameter widens (accepts strictly more at the type level) and gains an optional argument. `AppConfig`, `defineServerMiddleware`, `defineClientMiddleware`, and `defineStreamObserver` are untouched. Code that builds entries through the `define*` factories cannot trip the new check.
- **Behavior change on `hono-preact/internal`.** `partitionUse` is re-exported there (`packages/iso/src/internal.ts:111`) as an escape-hatch primitive, and it now throws where it previously tolerated anything. That is the fix, and it belongs in the v0.13 release notes.
- **`packages/vite/src/guard-strip.ts` stays valid.** Its build-time replacement literals carry `runs` and `fn` for middleware, and its observer replacement is the hookless `{ __kind: 'observer' }`, which `isObserver` accepts by design. Task 1 pins both shapes in tests.
- **Casts removed, none added in source:** `render.tsx:140`, `loader-runner-server.ts:79`, `compose-server-chain.ts:90`, and `server-caller.ts:97` (`entry as ServerMiddleware`, which the discriminated `isMiddleware(entry) && entry.runs === 'server'` narrowing makes unnecessary). The two `as unknown as T` casts in Tasks 3 and 4 are in test fixtures that deliberately construct values the public types cannot express, which is the sanctioned boundary.
