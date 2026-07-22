# Validate `use` entries at construction

Design for issue #321 (v0.13, rank 01). Closes the framework's one true
single-point fail-open: a malformed `use` entry that silently becomes a dropped
middleware.

## Problem

`partitionUse` classifies by exclusion:

```ts
for (const entry of use) {
  if (entry.__kind === 'middleware') middleware.push(entry);
  else observers.push(entry);
}
```

Anything that is not `__kind: 'middleware'` lands in the observer bucket. `use`
arrays are read structurally off user-defined modules (`ReadonlyArray<unknown>`
laundered through a cast at three call sites), so a typo, a wrong import, or a
build-time transform gone wrong produces an entry that is silently reclassified
rather than rejected. Observers do not gate: they receive stream lifecycle
callbacks and cannot deny. A middleware that becomes an observer is an auth gate
that does not run, with no second gate behind it.

Two further silent drops share the failure class:

- Every consumer then filters `m.runs === 'server'`. A middleware with a typo'd
  `runs` survives a `__kind`-only check and is still dropped from the server
  chain.
- `server-caller.ts`'s `serverMiddleware()` does not use `partitionUse` at all.
  It filters `__kind === 'middleware' && runs === 'server'` and discards
  everything else without comment, so the in-process `ctx.call()` path drops
  malformed entries too.

## Approach

Fail closed at the classification boundary. An entry is middleware, or an
observer, or an error; there is no third bucket. Validation lives at the choke
point rather than at each consumer, so all five classification sites are covered
by one check.

## Components

### `packages/iso/src/internal/use-entry.ts` (new)

Owns the classification contract. `use-partitioner.ts` goes back to doing only
the partition.

```ts
export function isMiddleware(entry: unknown): entry is Middleware;
export function isObserver(entry: unknown): entry is AnyObserver;
export function assertUseEntry(
  entry: unknown,
  index: number,
  source?: string
): void;
```

`isMiddleware` verifies the whole `Middleware` contract, not just the brand:

- the entry is a non-null object,
- `__kind === 'middleware'`,
- `runs` is `'server'` or `'client'`,
- `typeof fn === 'function'`.

The `runs` and `fn` checks are not incidental strictness. `runs` closes the
second-order silent drop described above. `fn` turns an opaque mid-dispatch
`TypeError` into a named construction-time error.

`isObserver` is symmetric:

- the entry is a non-null object,
- `__kind === 'observer'`,
- every *present* hook among `onStart`, `onChunk`, `onEnd`, `onError`,
  `onAbort` is a function.

Every hook is optional, so `{ __kind: 'observer' }` with no hooks stays legal.
That matters: `packages/vite/src/guard-strip.ts` replaces a stripped
`defineStreamObserver()` call with exactly that literal in the client bundle,
and its middleware replacements already carry `runs` and `fn`, so the stricter
predicates leave the build-time transform valid.

`assertUseEntry` throws when an entry satisfies neither predicate.

### Error message

Follows the repo convention (`label: what went wrong -- why it matters`) and
diagnoses the specific failure rather than restating the type:

```
Invalid `use` entry at index 2 of the app-level `use`: a middleware whose `runs`
is "sever" (expected 'server' or 'client'). A `use` entry the framework cannot
classify would be silently dropped from the middleware chain -- if this is an
auth gate, it would not run.
```

The describer branches on what it finds, so the message names the offending
entry in each case:

| Entry | Description |
| --- | --- |
| `{ __kind: 'middleware', runs: 'sever', fn }` | a middleware whose `runs` is `"sever"` (expected `'server'` or `'client'`) |
| `{ __kind: 'middleware', runs: 'server' }` | a middleware whose `fn` is not a function (undefined) |
| `{ __kind: 'observer', onChunk: 3 }` | an observer whose `onChunk` is not a function (number) |
| `{ __kind: 'middlware', ... }` | an object with `__kind` `"middlware"` (expected `'middleware'` or `'observer'`) |
| `{ fn }` | an object with no `__kind` |
| `null` / `undefined` | `null` / `undefined` |
| `() => {}` | a function |
| `'guard'` | a string (`"guard"`) |

The closing sentence (why it matters) is constant; only the description varies.

### `partitionUse`

```ts
export function partitionUse(
  use: ReadonlyArray<unknown>,
  source?: string
): { middleware: Middleware[]; observers: AnyObserver[] };
```

Validates every entry, throwing on the first failure, then partitions using the
same predicates. Widening the parameter to `ReadonlyArray<unknown>` deletes the
three casts that let malformed entries in:

- `packages/server/src/render.tsx:139` — `rootUse as ReadonlyArray<Middleware>`
- `packages/iso/src/internal/loader-runner-server.ts:78` — same cast on
  `loaderRef.use`
- `packages/server/src/compose-server-chain.ts:86-90` —
  `as ReadonlyArray<Middleware | StreamObserver<unknown, never>>` over the
  concatenated chain

This is the reshape CLAUDE.md's cast policy asks for: the data genuinely arrives
as `unknown` (structural reads off user modules), and the runtime check is now
the single source of truth for that boundary.

The optional `source` label names the layer in the error. Callers that know
their layer pass it.

### `compose-server-chain.ts`

Partitions each layer separately and concatenates, instead of partitioning one
merged array:

```ts
const root = partitionUse(rootUse, 'the app-level `use`');
const page = partitionUse(pageUse, `the page \`use\` for ${path}`);
const unit = partitionUse(unitUse, "the unit's own `use`");

const allMiddleware = [
  ...root.middleware,
  ...page.middleware,
  ...unit.middleware,
];
const observers = [...root.observers, ...page.observers, ...unit.observers];
```

Output order is identical to partitioning the concatenation (partitioning is
order-preserving within each bucket, and the layers concatenate in the same
outer -> inner order). The gain is a meaningful index: without this, "index 4"
spans three merged `use` arrays and does not locate anything.

### `server-caller.ts`

`serverMiddleware()` asserts every entry, then filters with the shared
predicate:

```ts
function serverMiddleware(
  use: ReadonlyArray<unknown> | undefined
): ReadonlyArray<ServerMiddleware> {
  const out: ServerMiddleware[] = [];
  const entries = use ?? [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    assertUseEntry(entry, i, "the action's own `use`");
    if (isMiddleware(entry) && entry.runs === 'server') out.push(entry);
  }
  return out;
}
```

Dropping a *valid* client middleware or observer here stays correct: the
in-process `call()` path runs neither. What changes is that an unclassifiable
entry now throws instead of vanishing. `ServerActionView['use']` widens from
`ReadonlyArray<{ __kind: string; runs?: string }>` to
`ReadonlyArray<unknown>`, since the predicate no longer needs the caller to
pre-shape it.

## Data flow

Unchanged. Validation is a guard at the front of the existing partition; nothing
downstream sees a different chain for valid input.

## Error handling

`assertUseEntry` throws a plain `Error`. Where that surfaces:

| Path | Surface |
| --- | --- |
| `composeServerChain` (loader/action RPC) | wrapped by `composeServerChainOrFailClosed`, so a route-bound unit fails closed with the handler's existing `{ ok: false }` response |
| `render.tsx` root SSR | throws during render, which the SSR error path already handles |
| `loader-runner-server.ts` | throws in the SSR loader runner, surfaced through the loader's error state |
| `page-middleware-host.tsx` | throws while starting the page chain |
| `server-caller.ts` | throws out of `ctx.call()` |

Every one of those is a loud failure in place of a silent bypass, which is the
point.

## Testing

- `packages/iso/src/internal/__tests__/use-entry.test.ts` (new): `isMiddleware`
  and `isObserver` over valid and each invalid shape; one assertion per row of
  the describer table above, checking the message names the entry.
- `packages/iso/src/internal/__tests__/use-partitioner.test.ts`: keep both
  existing pass cases; add throw cases for unknown `__kind`, `null`,
  `undefined`, a bare function, a bad `runs`, and a missing `fn`; assert the
  `source` label and the index appear in the message, using an invalid entry
  that is not first so a wrong index cannot pass.
- `packages/server/src/__tests__/compose-server-chain.test.ts`: a malformed
  entry in each of the three layers reports that layer and a layer-relative
  index; valid multi-layer input keeps its existing order.
- `packages/iso/src/__tests__/server-caller.test.ts`: a malformed entry in an
  action's `use` throws out of `call()` rather than being dropped; the existing
  "runs its own middleware" case still passes.

## Compatibility

`partitionUse` is exported from the `hono-preact/internal` escape-hatch surface,
so its behavior changes there: previously tolerant of any entry, now throwing.
That is the fix, not a side effect. It ships in v0.13 and belongs in the release
notes as a behavior change on `hono-preact/internal`.

No public API changes. `partitionUse`'s signature widens (accepts strictly more
at the type level), and `AppConfig`, `defineServerMiddleware`,
`defineClientMiddleware`, and `defineStreamObserver` are untouched. Code that
builds `use` entries through the `define*` factories cannot trip the new check.
