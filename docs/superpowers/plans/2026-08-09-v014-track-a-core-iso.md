# v0.14 Track A batch 1 (core / iso ergonomics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six triaged fixes from #318 (spec: `docs/superpowers/specs/2026-08-09-v014-track-a-core-iso-design.md`) and file the four promoted issues.

**Architecture:** Six independent changes to `packages/iso`, plus one cross-package rename that reaches `packages/vite`'s codegen and `packages/server`'s consumption. Two are dev-only warnings, one is type-only, one is additive, one is a rename, one is a breaking union change. Tasks are ordered lowest-risk first so the riskiest change (Task 6) lands against an otherwise-green tree.

**Tech Stack:** TypeScript, Preact, preact-iso, Vitest (unit + `test-d` typecheck mode), pnpm workspaces.

## Global Constraints

- **No em-dashes** in prose, comments, or commit messages (user's global instruction).
- **No inline type casts.** Reshape the type instead. Runtime checks are written as type predicates so narrowing carries through. Sanctioned boundaries (untrusted JSON, FormData, user module exports) get a comment, not a rewrite. See CLAUDE.md.
- **Dev-warn idiom, verbatim from this codebase:** dev detection is written *inline*, never behind a helper taking the message as an argument, or the long string stays referenced and never tree-shakes (`define-loader.ts:505-507`). The condition is `typeof import.meta.env === 'undefined' || import.meta.env.SSR || import.meta.env.DEV`.
- **Never read `import.meta.env` at module scope.** It breaks the site build. Read it inside the function.
- **Warning message prefix is `hono-preact: `**, and repeated warnings dedupe through a module-level `Set` keyed by the offending identity (`page-actions-handler.ts:152-176`).
- **v0.14 carries no non-breaking commitment.** Take the right name and the right shape; record the break in the release notes.
- **Mutation-check every regression test:** confirm it fails against the unfixed code before trusting it. A test that passes against the callee proves nothing about a wrong-argument bug at the caller.
- **Test files are never typechecked by the build `tsc`.** Run `pnpm typecheck:tests` for `*.test.ts(x)` and `pnpm test:types` for `*.test-d.ts`.
- `pnpm --filter <pkg> test` is a silent no-op. Run `pnpm exec vitest run <pattern>` from the repo root.

---

### Task 1: Align the `RouteBinder.room` `Data` default

**Files:**
- Modify: `packages/iso/src/server-route.ts:188`
- Test: `packages/iso/src/__tests__/define-room.test-d.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on.

`server-route.ts:184-192` declares `room<Name, Payload, State = void, Data = Record<string, unknown>>`. `define-room.ts:224` and `:243` both default `Data = undefined` after #203. The two spellings of the same concept disagree; `undefined` is correct.

- [ ] **Step 1: Write the failing type test**

Append to `packages/iso/src/__tests__/define-room.test-d.ts`:

```ts
import { expectTypeOf, test } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineChannel } from '../define-channel.js';

test('route-bound room Data default matches defineRoom Data default', () => {
  const channel = defineChannel<'room/:roomId', { text: string }>('room/:roomId');
  const ref = serverRoute('/demo/rooms/:roomId').room(channel, {
    onJoin: (ctx) => {
      // With Data defaulting to `undefined` (matching defineRoom), `ctx.data`
      // is the empty-data shape, not an index-signature record.
      expectTypeOf(ctx.data).not.toEqualTypeOf<Record<string, unknown>>();
    },
  });
  expectTypeOf(ref).not.toBeNever();
});
```

Adjust the `onJoin` handler shape to whatever `RoomHandler` actually requires; read `define-room.ts:60-90` first and match the existing `define-room.test-d.ts` cases rather than inventing a handler shape.

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm test:types`
Expected: FAIL on the `not.toEqualTypeOf<Record<string, unknown>>()` assertion, because the default is currently exactly that.

- [ ] **Step 3: Change the default**

In `packages/iso/src/server-route.ts`, in the `room<...>` signature:

```ts
  room<
    Name extends string,
    Payload,
    State = void,
    Data = undefined,
  >(
```

- [ ] **Step 4: Run the type tests and the full typecheck**

Run: `pnpm test:types && pnpm typecheck`
Expected: PASS. If `apps/site` fails, a site room was relying on the wide default; fix the site by naming its `Data` explicitly rather than reverting this change.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/server-route.ts packages/iso/src/__tests__/define-room.test-d.ts
git commit -m "fix(iso): align RouteBinder.room Data default with defineRoom

server-route.ts defaulted Data to Record<string, unknown> while
define-room.ts defaults it to undefined after #203. Refs #318."
```

---

### Task 2: `buildPath` accepts `string[]` for rest params

**Files:**
- Modify: `packages/iso/src/internal/typed-routes.ts` (add `BuildParams`)
- Modify: `packages/iso/src/internal/interpolate-pattern.ts`
- Modify: `packages/iso/src/build-path.ts`
- Test: `packages/iso/src/__tests__/build-path.test.ts`

**Interfaces:**
- Consumes: `RouteParams<P>`, `interpolatePattern(pattern, values)`.
- Produces: `BuildParams<P>` exported from `internal/typed-routes.ts`; `interpolatePattern` now accepts `Record<string, string | string[] | undefined>`.

Today `build-path.ts:17-19` documents the gap: wildcard values are percent-encoded whole, so `%2F` appears instead of real separators, and the docstring tells the caller to build that part themselves. The fix is additive: plain `string` keeps today's behaviour exactly, `string[]` joins encoded segments with `/`.

**Design note (do not skip):** do **not** widen `RouteParams`. `RouteParams` is the *read* type (`useParams` returns it, and live param values are always `string`). Widening it would wrongly tell readers a param may be an array. Build gets its own type.

- [ ] **Step 1: Write the failing tests**

Append to `packages/iso/src/__tests__/build-path.test.ts`:

```ts
test('rest param accepts a string[] and joins with real separators', () => {
  expect(buildPath('/docs/:rest*', { rest: ['a', 'b', 'c'] })).toBe('/docs/a/b/c');
});

test('rest param encodes each segment individually', () => {
  expect(buildPath('/docs/:rest*', { rest: ['a b', 'c/d'] })).toBe('/docs/a%20b/c%2Fd');
});

test('an empty array drops the segment rather than emitting //', () => {
  expect(buildPath('/docs/:rest*', { rest: [] })).toBe('/docs');
});

test('a plain string rest param keeps its existing whole-value encoding', () => {
  expect(buildPath('/docs/:rest*', { rest: 'a/b' })).toBe('/docs/a%2Fb');
});
```

`buildPath`'s first param is typed `RegisteredPaths`, which falls back to `string` when unregistered. Match how the existing tests in this file spell their patterns; if they register a route tree, follow that.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec vitest run packages/iso/src/__tests__/build-path.test.ts`
Expected: FAIL. The `string[]` cases produce `/docs/a%2Cb%2Cc` (array coerced by `encodeURIComponent`), and the empty-array case produces `/docs/` or similar. Note the actual failure output; it confirms the array is reaching `encodeURIComponent` unhandled.

- [ ] **Step 3: Teach `interpolatePattern` about array values**

In `packages/iso/src/internal/interpolate-pattern.ts`, widen the signature and add the array branch. Keep every existing comment; they document decisions still in force.

```ts
export function interpolatePattern(
  pattern: string,
  values: Record<string, string | string[] | undefined>
): string {
```

Inside the `.map((seg) => {...})`, after `const value = values[m[1]];` and before the existing drop check, add:

```ts
      // A rest param supplied as segments: encode each individually and join
      // with real separators, so `['a', 'b']` builds `a/b` rather than the
      // `a%2Cb` a whole-value encode would produce. An empty array is absent,
      // and drops the segment like `''` does below (no `//` in the output).
      if (Array.isArray(value)) {
        return value.length === 0
          ? null
          : value.map((part) => encodeURIComponent(part)).join('/');
      }
```

- [ ] **Step 4: Add the build-side param type**

In `packages/iso/src/internal/typed-routes.ts`, below `RouteParams`, add:

```ts
// A rest param (`:name*` / `:name+`) may be BUILT from segments as well as
// from a whole string. This is deliberately separate from `RouteParams`, which
// is the READ type: a live param value off the route match is always a string,
// so widening `RouteParams` would lie to `useParams` callers.
type IsRestSeg<Seg extends string> = Seg extends `${string}*`
  ? true
  : Seg extends `${string}+`
    ? true
    : false;

type BuildParamFrom<Seg extends string> =
  StripModifier<Seg> extends {
    name: infer Name extends string;
    optional: infer Optional;
  }
    ? IsParamName<Name> extends true
      ? IsRestSeg<Seg> extends true
        ? Optional extends true
          ? { [K in Name]?: string | string[] }
          : { [K in Name]: string | string[] }
        : Optional extends true
          ? { [K in Name]?: string }
          : { [K in Name]: string }
      : {}
    : {};

/**
 * The params object `buildPath` accepts for a pattern. Identical to
 * `RouteParams` except that rest params (`:name*` / `:name+`) also accept
 * `string[]`, whose entries are encoded individually and joined with `/`.
 */
export type BuildParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? BuildParamFrom<Param> & BuildParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? BuildParamFrom<Param>
      : {};
```

- [ ] **Step 5: Point `buildPath` at `BuildParams` and correct its docstring**

In `packages/iso/src/build-path.ts`:

```ts
import type { RegisteredPaths, BuildParams } from './internal/typed-routes.js';
import { interpolatePattern } from './internal/interpolate-pattern.js';

// Param-less routes take no second argument; routes with params require the
// matching params object. `keyof {} extends never` is true, so param-less
// patterns resolve to the empty tuple.
type BuildArgs<P extends string> = keyof BuildParams<P> extends never
  ? []
  : [params: BuildParams<P>];
```

Replace the wildcard paragraph of the docstring (currently lines 17-19) with:

```
 * For wildcard params (`:rest*`, `:rest+`), pass `string[]` to build real
 * slash-separated segments; each entry is encoded individually
 * (`{ rest: ['a', 'b'] }` builds `a/b`). A plain string is encoded whole, so
 * embedded `/` characters become `%2F`.
```

And widen the implementation signature:

```ts
export function buildPath(
  pattern: string,
  params?: Record<string, string | string[] | undefined>
): string {
  return interpolatePattern(pattern, params ?? {});
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run packages/iso/src/__tests__/build-path.test.ts packages/iso/src/__tests__/define-channel.test.ts && pnpm test:types && pnpm typecheck`
Expected: PASS. `define-channel` is in this run deliberately: it shares `interpolatePattern`, and this step widened that shared function's input type.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/build-path.ts packages/iso/src/internal/interpolate-pattern.ts packages/iso/src/internal/typed-routes.ts packages/iso/src/__tests__/build-path.test.ts
git commit -m "feat(iso): buildPath builds multi-segment wildcard paths from string[]

Rest params accept string[], encoding each segment individually and
joining with '/'. Plain strings keep their whole-value encoding, so the
change is additive. Refs #318."
```

---

### Task 3: `useParams` dev-warn on no-match

**Files:**
- Modify: `packages/iso/src/use-params.ts`
- Test: `packages/iso/src/__tests__/use-params.test.tsx`

**Interfaces:**
- Consumes: `useRoute()` from `preact-iso`, `useRouteMatch` from `./route-active.js` (confirmed to exist at `route-active.ts:24` and exported from `index.ts:92`).
- Produces: nothing later tasks depend on.

`useParams` no longer asserts (the #318 premise is stale). It is a plain typed read whose returned object does not have the shape its type promises when the named route is not the active one, with no signal to the author.

- [ ] **Step 1: Write the failing tests**

Append to `packages/iso/src/__tests__/use-params.test.tsx`. Follow the file's existing render/route-setup helpers rather than inventing new ones.

```tsx
test('warns in dev when the named route is not the active route', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Render at a location that does NOT match '/users/:userId'.
  renderAtPath('/projects/abc', () => {
    useParams('/users/:userId');
    return null;
  });
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining("useParams('/users/:userId')")
  );
  warn.mockRestore();
});

test('does not warn when the named route is the active route', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  renderAtPath('/users/u1', () => {
    useParams('/users/:userId');
    return null;
  });
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('warns only once per route pattern', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  renderAtPath('/projects/abc', () => {
    useParams('/users/:userId');
    useParams('/users/:userId');
    return null;
  });
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
```

`renderAtPath` is a stand-in: use whatever the existing tests in this file use to render a component under a given location. Read the file's first 40 lines before writing.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec vitest run packages/iso/src/__tests__/use-params.test.tsx`
Expected: FAIL on the first and third tests (no warning is emitted today). The second should already pass; that is expected and is the control.

- [ ] **Step 3: Implement the warning**

Rewrite `packages/iso/src/use-params.ts`:

```ts
import { useRoute } from 'preact-iso';
import { useRouteMatch } from './route-active.js';
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';

// Dedupe key is the route pattern: a mismatched `useParams` in a component
// that re-renders would otherwise warn on every render. Module-level, matching
// the `warned` set in page-actions-handler.ts.
const warnedRoutes = new Set<string>();

/**
 * Typed route params for the named route. `route` is a type-level selector that
 * names which route's param shape to project; the live param values come from
 * the active route match. Constrain to the registered route union once an app
 * adds the `declare module 'hono-preact'` registration; until then any string
 * is accepted and its param shape projected.
 *
 * ```tsx
 * const { projectId } = useParams('/demo/projects/:projectId');
 * ```
 *
 * The named route must be the active one. When it is not, the returned object
 * does not have the shape this projects, and dev builds warn. Reach for
 * `useRouteMatch(route)` when the route may legitimately not be active: it
 * returns the match or `null` rather than projecting a shape that is not there.
 */
export function useParams<P extends RegisteredPaths>(route: P): RouteParams<P> {
  const match = useRouteMatch(route);
  if (match === null && !warnedRoutes.has(route)) {
    warnedRoutes.add(route);
    if (
      typeof import.meta.env === 'undefined' ||
      import.meta.env.SSR ||
      import.meta.env.DEV
    ) {
      console.warn(
        `hono-preact: useParams('${route}') was called where that route is ` +
          `not the active route, so the returned params do not have the ` +
          `shape it projects. Use useRouteMatch('${route}') when the route ` +
          `may not be active; it returns null instead of a mis-shaped object.`
      );
    }
  }
  // The structural read off Record<string, string> is the one sanctioned cast
  // boundary: the runtime value lacks the literal that `route` names.
  return useRoute().pathParams as RouteParams<P>;
}
```

Two notes for the implementer:

1. `useRouteMatch` is a hook. It must be called unconditionally, before the branch, which the code above does. Do not move it inside the `if`.
2. Check `useRouteMatch`'s actual signature at `route-active.ts:24` first. Its `route` param is typed `RoutePattern`, which is `RegisteredPaths | (string & {})`, so a `RegisteredPaths` argument is accepted without a cast. If it turns out to need options, pass none.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run packages/iso/src/__tests__/use-params.test.tsx && pnpm typecheck:tests`
Expected: PASS, all three.

- [ ] **Step 5: Mutation-check**

Temporarily change `match === null` to `match !== null`. Re-run. Expected: tests 1 and 2 both fail. Revert the mutation (edit it back by hand; do **not** `git checkout --` the file, which would discard the whole task's work).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/use-params.ts packages/iso/src/__tests__/use-params.test.tsx
git commit -m "feat(iso): dev-warn when useParams names a non-active route

The returned object does not have the shape useParams projects when the
named route is not active, and nothing said so. Points at useRouteMatch
as the optional form. Dev-only; production is unchanged. Refs #318."
```

---

### Task 4: dev-check that leaf views carry the `definePage` marker

**Files:**
- Modify: `packages/iso/src/define-page.tsx` (add and export the marker)
- Modify: `packages/iso/src/define-routes.tsx` (the leaf-view check)
- Test: `packages/iso/src/__tests__/define-page.test.tsx`

**Interfaces:**
- Consumes: `definePage(Component, bindings?)` as it exists today.
- Produces: `DEFINE_PAGE_MARKER` (a `symbol`) and `isDefinePageComponent(value): value is FunctionComponent<RouteHook>`, both exported from `define-page.tsx`.

A leaf view registered without `definePage` silently loses its route error boundary. `definePage` currently leaves only a `displayName` behind, which is a string a user could coincidentally match; a symbol is the honest marker.

**Cast policy:** the detection is written as a **type predicate** with a plain `in` check, following the `isLiveStreamFn` precedent described at `define-loader.ts:519-524`. No `as`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/iso/src/__tests__/define-page.test.tsx`:

```tsx
import { definePage, isDefinePageComponent } from '../define-page.js';

test('definePage stamps its marker onto the returned component', () => {
  const Wrapped = definePage(() => null);
  expect(isDefinePageComponent(Wrapped)).toBe(true);
});

test('a bare component is not marked', () => {
  const Bare = () => null;
  expect(isDefinePageComponent(Bare)).toBe(false);
});

test('warns once in dev when a leaf view is registered without definePage', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const Bare = () => null;
  Bare.displayName = 'BareLeaf';
  defineRoutes([{ path: '/bare', view: Bare }]);
  defineRoutes([{ path: '/bare', view: Bare }]);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('BareLeaf'));
  warn.mockRestore();
});

test('does not warn for a view wrapped in definePage', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  defineRoutes([{ path: '/ok', view: definePage(() => null) }]);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
```

Read `define-routes.tsx` first and match the real route-node shape and the real `defineRoutes` signature. The `{ path, view }` spelling above is illustrative; use whatever the existing `define-routes.test.tsx` cases use.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec vitest run packages/iso/src/__tests__/define-page.test.tsx`
Expected: FAIL, `isDefinePageComponent` is not exported.

- [ ] **Step 3: Add the marker and its predicate**

In `packages/iso/src/define-page.tsx`:

```tsx
/**
 * Stamped onto the component `definePage` returns, so route registration can
 * tell a wrapped leaf view from a bare one and warn about the route error
 * boundary a bare view silently loses. A symbol, not a `displayName` string:
 * a string marker is one a user component could coincidentally carry.
 */
export const DEFINE_PAGE_MARKER = Symbol.for('hono-preact.definePage');

/**
 * True for a component `definePage` produced. A plain `in` check written as a
 * type predicate so narrowing carries through, matching `isLiveStreamFn`.
 */
export function isDefinePageComponent(
  value: unknown
): value is FunctionComponent<RouteHook> {
  return typeof value === 'function' && DEFINE_PAGE_MARKER in value;
}
```

Declare the marker on the returned component's type so the write needs no cast. Extend the return type rather than casting at the assignment:

```tsx
type DefinePageComponent = FunctionComponent<RouteHook> & {
  [DEFINE_PAGE_MARKER]: true;
};

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: DefinePageComponent = Object.assign(
    () => (
      <Page Wrapper={bindings?.Wrapper} errorFallback={bindings?.errorFallback}>
        <Component />
      </Page>
    ),
    { [DEFINE_PAGE_MARKER]: true as const }
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
```

- [ ] **Step 4: Add the leaf-view check in `define-routes.tsx`**

Find where `defineRoutes` walks nodes and reads a node's `view`. A leaf view is a node with a `view` and no `children`. Add, at that point:

```tsx
      if (
        typeof import.meta.env === 'undefined' ||
        import.meta.env.SSR ||
        import.meta.env.DEV
      ) {
        warnBareLeafView(node.view);
      }
```

And at module scope in `define-routes.tsx`:

```tsx
// Keyed by the component itself: the same bare view registered twice (a shared
// leaf, or a test re-registering) warns once.
const warnedBareViews = new WeakSet<object>();

function warnBareLeafView(view: unknown): void {
  if (typeof view !== 'function') return;
  if (isDefinePageComponent(view)) return;
  if (warnedBareViews.has(view)) return;
  warnedBareViews.add(view);
  const name = view.displayName ?? view.name ?? 'Anonymous';
  console.warn(
    `hono-preact: leaf view '${name}' is registered without definePage, so ` +
      `it has no route error boundary and a throw during its render escapes ` +
      `to the nearest ancestor boundary. Wrap it: definePage(${name}).`
  );
}
```

Reading `view.displayName` off a `Function` needs the narrowing to have happened first; `typeof view !== 'function'` above provides it. If TypeScript still objects to `displayName` on `Function`, type the parameter as `ComponentType | unknown` and narrow with a predicate rather than reaching for a cast.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run packages/iso/src/__tests__/define-page.test.tsx packages/iso/src/__tests__/define-routes.test.tsx && pnpm typecheck && pnpm typecheck:tests`
Expected: PASS. If `define-routes.test.tsx` now emits warnings for its own bare fixture views, that is the check working; update those fixtures to use `definePage`, or assert the warning, rather than weakening the check.

- [ ] **Step 6: Check the site is clean**

Run: `pnpm --filter site build`
Expected: PASS with no `leaf view ... registered without definePage` warnings. If any appear, they are real findings: fix the site's routes.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/define-page.tsx packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-page.test.tsx
git commit -m "feat(iso): dev-warn when a leaf view is registered without definePage

A bare leaf view silently loses its route error boundary. definePage now
stamps a symbol marker, and route registration warns once per bare view.
Dev-only. Refs #318."
```

---

### Task 5: Rename the loader `params` cache-dep list to `cacheKeyParams`

**Files:**
- Modify: `packages/iso/src/define-loader.ts:215`, `:409`, `:784`
- Modify: `packages/vite/src/stub-templates.ts` (emits the key as a **string literal** in generated code)
- Modify: `packages/vite/src/source-extraction.ts` (extracts the key)
- Modify: `apps/site/src/pages/demo/project-board.server.ts:91,136`
- Modify: `apps/site/src/pages/docs/loaders.mdx:557,563`, `apps/site/src/pages/docs/validation.mdx:277`
- Test: `packages/vite/src/__tests__/server-only-server-loaders.test.ts` (asserts on the emitted string)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the loader option is named `cacheKeyParams` (type `string[] | '*'`, default `[]`) everywhere after this task. Task 7's docs work depends on this name.

`params` (the cache-dependency list) and `paramsSchema` (the path-params schema) read as a pair and are unrelated. `cacheKeyParams` says what the list is for and cannot be misread as a variant of `paramsSchema`.

**The trap in this task:** the rename crosses a codegen boundary. `packages/vite/src/stub-templates.ts` emits the property name inside a **template string**, and `source-extraction.ts` reads it back. Neither is typechecked against `define-loader.ts`. `pnpm typecheck` passing does **not** mean this rename is complete. The vite unit tests that assert on emitted code are the check that does catch it.

Do **not** blanket find-and-replace `params`. The token appears as `pathParams`, `paramsSchema`, `RouteParams`, `BuildParams`, room/channel params, and more. Rename only the loader-option occurrences enumerated above.

- [ ] **Step 1: Rename the type members in `define-loader.ts`**

Three sites, each `params` to `cacheKeyParams`:

- `:215` `readonly params: string[] | '*';` in the resolved-metadata type
- `:409` `params?: string[] | '*';` in the authored-options type
- `:784` `params: opts?.params ?? [],` in the constructor body, which becomes `cacheKeyParams: opts?.cacheKeyParams ?? [],`

Also check `:430`, which lists `'paramsSchema' | 'searchSchema' | 'params'` as a key union; the `'params'` member there is this same option and must be renamed too. Update the surrounding docstrings: `:218` describes `paramsSchema`, and whatever comment describes the cache-dep list needs its name corrected.

- [ ] **Step 2: Run typecheck to enumerate the internal call sites**

Run: `pnpm typecheck`
Expected: FAIL, listing every typed reader of the old name across `packages/` and `apps/site`. Fix each to `cacheKeyParams`. Re-run until clean. This is the reliable enumeration for the typed half of the rename.

- [ ] **Step 3: Rename across the codegen boundary**

In `packages/vite/src/stub-templates.ts`, the emitted template contains the property name as text (around the `params: __meta && __meta.params` emission). Rename both the emitted key and the metadata read.

In `packages/vite/src/source-extraction.ts`, the extractor reads the option off the parsed source; rename the key it looks for.

Grep to confirm nothing was missed, excluding the unrelated spellings:

```bash
rg -n "\bparams\b" packages/vite/src packages/iso/src/define-loader.ts \
  | rg -v "pathParams|paramsSchema|RouteParams|BuildParams|searchParams|roomKey|channel"
```

Expected after the rename: no hits describing the loader cache-dep option.

- [ ] **Step 4: Run the vite tests that assert on emitted code**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-only-server-loaders.test.ts`
Expected: FAIL first, on the assertion that the emitted code contains the old key. Update the assertion to `cacheKeyParams` and re-run to PASS. If this test passed *before* you updated it, the codegen rename did not land; go back to Step 3.

- [ ] **Step 5: Update the site and the docs prose**

Rename the option at `apps/site/src/pages/demo/project-board.server.ts:91` and `:136`.

Update the docs snippets at `apps/site/src/pages/docs/loaders.mdx:557,563` and `apps/site/src/pages/docs/validation.mdx:277`, including any surrounding prose that names the option. Per the repo's docs rule, describe what the option **is**; do not add "formerly `params`" breadcrumbs. The rename belongs in the release notes (Task 7), not in the reference docs.

Leave `docs/superpowers/plans/` and `docs/superpowers/specs/` untouched. Those are historical records of past work and must not be rewritten.

- [ ] **Step 6: Full verification**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck && pnpm typecheck:tests && pnpm test:types && pnpm test && pnpm --filter site build`
Expected: all PASS. The build must run first: `pnpm typecheck` and `apps/site` resolve cross-package types through the published `dist/`, so a stale `dist/` shows this rename as a fake "missing export".

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(iso)!: rename the loader params cache-dep list to cacheKeyParams

BREAKING CHANGE: the defineLoader option \`params\` is now \`cacheKeyParams\`.
It sat next to \`paramsSchema\` and read as a variant of it, while being an
unrelated cache-dependency list. Renamed before more call sites form.
Refs #318."
```

---

### Task 6: `mutate` settles after a same-origin redirect

**Files:**
- Modify: `packages/iso/src/action.ts` (the `MutateResult` type near `:299`, the `failure` helper, the success branch near `:668`, the navigated branch near `:724`)
- Test: `packages/iso/src/__tests__/action.test.tsx`
- Modify: `packages/iso/src/__tests__/mutate-arm-helpers.ts` (add a navigated-arm helper)

**Interfaces:**
- Consumes: `applyDecodedOutcome(decoded, handlers)`, `applyInvalidate(opts)`, `DenyRecord<TDenyData>`.
- Produces: the four-arm `MutateResult<TResult, TDenyData>` shown below. Task 7's docs work depends on this exact shape.

`action.ts:724-728` returns `new Promise(() => {})` under the comment `Same-origin redirect issued; this promise never settles.` That is deliberate (the component is navigating away) but it dead-ends `await mutate()`, never fires `.finally()`, and leaks a pending promise on every redirecting call.

- [ ] **Step 1: Write the failing tests**

Append to `packages/iso/src/__tests__/action.test.tsx`. `renderActionHook` below is a **stand-in name**: this file already has a way to render `useAction` against a mocked response, and these tests must use it rather than introduce a second harness. Read the existing deny and error cases first, and mirror exactly how they shape and mock their outcome envelopes, substituting the `navigated` outcome.

```tsx
test('mutate settles with the navigated arm on a same-origin redirect', async () => {
  const { mutate } = renderActionHook(/* action that redirects same-origin */);
  const result = await mutate({ id: '1' });
  expect(result).toEqual({ ok: true, kind: 'navigated' });
});

test('onSuccess does not fire for the navigated arm', async () => {
  const onSuccess = vi.fn();
  const { mutate } = renderActionHook(/* redirecting action */, { onSuccess });
  await mutate({ id: '1' });
  expect(onSuccess).not.toHaveBeenCalled();
});

test('a redirecting mutation still invalidates its declared loaders', async () => {
  const loader = defineLoader(async () => ({ n: 1 }));
  const invalidate = vi.spyOn(loader, 'invalidate');
  const { mutate } = renderActionHook(/* redirecting action */, {
    invalidate: [loader],
  });
  await mutate({ id: '1' });
  expect(invalidate).toHaveBeenCalled();
});

test('the success arm carries kind: success', async () => {
  const { mutate } = renderActionHook(/* ordinary action returning { id } */);
  const result = await mutate({ id: '1' });
  expect(result).toEqual({ ok: true, kind: 'success', data: { id: '1' } });
});
```

The third test is the one the spec calls for explicitly, and it is testing at the **caller**: `mutate()` against a redirecting handler, not `applyDecodedOutcome` in isolation. A test that only exercises the decode helper proves nothing about the early return, which is where the bug lives.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec vitest run packages/iso/src/__tests__/action.test.tsx`
Expected: the redirect tests hang until the suite timeout (the promise never settles) rather than failing with an assertion. That timeout **is** the bug reproducing. The `kind: 'success'` test fails on a plain assertion diff.

- [ ] **Step 3: Widen `MutateResult`**

In `packages/iso/src/action.ts`, replace the type near `:299`:

```ts
export type MutateResult<TResult, TDenyData = unknown> =
  | { ok: true; kind: 'success'; data: Serialize<TResult> | undefined }
  | { ok: true; kind: 'navigated' }
  | { ok: false; kind: 'deny'; deny: DenyRecord<TDenyData> }
  | { ok: false; kind: 'error'; error: Error };
```

Update the docstring above it. It currently describes three arms and calls itself a "three-arm discriminated union"; it must now describe four, with `kind` named as the discriminant across all of them. Add for the new arm:

```
 * - Navigated: `{ ok: true, kind: 'navigated' }`. The action issued a
 *   same-origin redirect and navigation is in flight. There is no result
 *   value, `onSuccess` does not fire, and the component this was called from
 *   is probably unmounting: do not assume it is still mounted after awaiting
 *   this arm. Declared loaders are still invalidated, since a redirect after
 *   a mutation usually lands on a page rendering the data it just changed.
```

- [ ] **Step 4: Update the success branch and the `failure` helper**

The `failure` helper near `:302` builds the two `ok: false` arms; it already sets `kind`, so it needs no change. Verify that.

Every place that returns the success arm must now include `kind: 'success'`. There is one at `:763` (`return { ok: true, data: finalResult };`) and possibly others in the streaming branch. Grep for `ok: true` within `action.ts` and update each.

```ts
      return { ok: true, kind: 'success', data: finalResult };
```

- [ ] **Step 5: Replace the never-settling return**

At `action.ts:722-729`, the current shape is:

```ts
          if (navigated) {
            // Same-origin redirect issued; this promise never settles.
            return await new Promise<MutateResult<TResult, TDenyData>>(
              () => {}
            );
          }
        }

        applyInvalidate(currentOptions?.invalidate);
```

Replace with an invalidate-then-settle, so invalidation runs on this path too:

```ts
          if (navigated) {
            // Same-origin redirect issued and navigation is in flight. Settle
            // rather than parking forever: an unsettled promise dead-ends
            // `await mutate()`, never runs `.finally()`, and leaks. Invalidate
            // first, since the destination usually renders the data this
            // mutation just changed and would otherwise serve a stale loader.
            applyInvalidate(currentOptions?.invalidate);
            return { ok: true, kind: 'navigated' };
          }
        }

        applyInvalidate(currentOptions?.invalidate);
```

Leave the `navigated: () => {}` handler at `:682` as the no-op it is; it correctly does not call `invokeSuccess`, which is what keeps `onSuccess` from firing for this arm.

- [ ] **Step 6: Add the navigated-arm test helper**

`packages/iso/src/__tests__/mutate-arm-helpers.ts` exports `denyArm` and `errorArm`. Add the matching narrowing helper so tests read consistently:

```ts
export function isNavigatedArm(
  result: MutateResult<unknown>
): result is { ok: true; kind: 'navigated' } {
  return result.ok && result.kind === 'navigated';
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm exec vitest run packages/iso/src/__tests__/action.test.tsx packages/iso/src/__tests__/action-cancellation.test.tsx packages/iso/src/__tests__/action-envelope.test.ts packages/iso/src/__tests__/action-result-store.test.ts`
Expected: PASS, and notably no timeouts.

- [ ] **Step 8: Fix the fallout across the repo**

Run: `pnpm typecheck && pnpm typecheck:tests && pnpm test:types`
Expected: FAIL, at every site doing `if (r.ok) use(r.data)`. That is the designed outcome of this shape: each one is a call site that was ignoring the navigated case. Fix each by narrowing on `kind` rather than by widening the type back.

The site's demo tests (`apps/site/src/pages/demo/__tests__/task.server.test.ts` and `project-board.server.test.ts`) narrow on `.ok` in many places and will need updating.

- [ ] **Step 9: Full verification**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm test && pnpm --filter site build`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "fix(iso)!: settle mutate after a same-origin redirect

BREAKING CHANGE: MutateResult's success arm now carries kind: 'success',
making \`kind\` the uniform discriminant across all four arms, and a new
{ ok: true, kind: 'navigated' } arm replaces the promise that previously
never settled on a same-origin redirect. Callers doing \`if (r.ok)
use(r.data)\` now get a compile error instead of a silent undefined.
Declared loaders are invalidated on the navigated path. Refs #318."
```

---

### Task 7: Docs sync, release notes, and the four promoted issues

**Files:**
- Modify: `apps/site/src/pages/docs/actions.mdx` (the `mutate` row and the `MutateResult` type block)
- Modify: `apps/site/src/pages/docs/__tests__/type-members-known-gaps.json` (only if the gate demands it)
- Modify: `apps/site/src/pages/docs/loaders.mdx` (the `useParams` / `useRouteMatch` guidance, if that page covers it)
- Create: `docs/superpowers/specs/2026-08-09-v0.14-release-notes.md` (or append to the existing v0.14 notes if one exists by then)

**Interfaces:**
- Consumes: `cacheKeyParams` (Task 5), the four-arm `MutateResult` (Task 6), `useRouteMatch` guidance (Task 3).
- Produces: nothing.

- [ ] **Step 1: Update `actions.mdx` for the four-arm union**

Two places. The `mutate` row of the API table currently reads "Resolves with a three-arm discriminated union" and lists `{ ok: true; data }`. It must describe four arms with `kind` as the discriminant. The `MutateResult` type block further down must be replaced with the exact shape from Task 6.

Per the repo's docs rule, describe what the type **is**. Do not write "previously three arms" or "the success arm now carries `kind`"; that belongs in the release notes.

- [ ] **Step 2: Run the docs coverage gate**

Run: `pnpm exec vitest run apps/site/src/pages/docs/__tests__`
Expected: PASS. `MutateResult` is named in a docs code span, and naming a type opts in **all** of its members, so the new `kind` member on the success arm and the whole `navigated` arm must both be documented or the gate fails. Document them; only add to `type-members-known-gaps.json` if there is a real reason a member cannot be documented, and say what it is.

Note the repo gotcha: the type-members gate needs the member and the type in **one** code span.

- [ ] **Step 3: Document `useRouteMatch` as the optional form**

Find where the docs cover `useParams` (start with `loaders.mdx` and `routing`-related pages; grep for `useParams` under `apps/site/src/pages/docs/`). Add the guidance from Task 3's docstring: `useParams` requires the named route to be active, and `useRouteMatch` is the form for when it may not be.

- [ ] **Step 4: Write the v0.14 release-notes entries**

Following the format of `docs/superpowers/specs/2026-08-09-v0.13-release-notes.md`, record the three breaking changes with migration guidance:

1. **`MutateResult` is now four arms, discriminated by `kind`.** The success arm carries `kind: 'success'`. A new `{ ok: true, kind: 'navigated' }` arm settles what previously never settled. Migration: `if (r.ok) use(r.data)` becomes `if (r.ok && r.kind === 'success') use(r.data)`. State plainly that this is the second consecutive breaking change to this type, after v0.13 split it three ways, and why (v0.13 introduced the arms; v0.14 regularizes the discriminant and fixes a promise that never settled).
2. **`defineLoader`'s `params` option is now `cacheKeyParams`.** Mechanical rename; `paramsSchema` is unchanged.
3. **`RouteBinder.room`'s `Data` default is now `undefined`**, matching `defineRoom`. Affects only code relying on the wider `Record<string, unknown>` default; name `Data` explicitly if you were.

Also list the two new dev warnings (`useParams` no-match, bare leaf view) as non-breaking additions, and `buildPath`'s `string[]` rest params as an additive feature.

- [ ] **Step 5: File the four promoted issues**

Each on milestone v0.14, each linking back to #318 and to the spec. Use the spec's "Out of scope" section as the body source.

```bash
gh issue create --milestone v0.14 --title "match() helper for status-first loader-state narrowing (from #318)" --body "..."
gh issue create --milestone v0.14 --title "Split invalidate's tri-mode into clear-only vs refetch semantics (from #318)" --body "..."
gh issue create --milestone v0.14 --title "View generics: Acc inference and the render-prop namespace collision (from #318)" --body "..."
gh issue create --milestone v0.14 --title "NavLink prefetch integration (from #318)" --body "..."
```

The `View` issue's body **must** open with the reproduction requirement: #318 claims `Acc` never infers from `initial`, but `Acc` appears in `initial: Acc` at `define-loader.ts:152-156`. Reproduce the failure before designing anything. If it does not reproduce, that half of the issue closes.

- [ ] **Step 6: Record the triage on #318 and close it**

Comment on #318 with the six-implemented / four-promoted split, linking the four new issue numbers, and noting that three of the ten original premises had drifted (`useParams` no longer asserts; the `View`/`Acc` claim is unverified; all line numbers in the issue body are stale). Then close it.

- [ ] **Step 7: Full pre-push verification**

Run the nine CI steps from CLAUDE.md, in order:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm typecheck:tests
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all PASS. If `format:check` fails, run `pnpm format` and commit the result. Do not push without having personally seen all nine pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: sync actions/loaders docs and v0.14 notes for the #318 batch"
```

---

## Notes for the implementer

**Work in a worktree, not the primary checkout on `main`.** Create it with the `superpowers:using-git-worktrees` skill, then run `pnpm wt:setup` inside it as an explicit next step (creating the worktree does not trigger setup). Use worktree-prefixed absolute paths for every edit; a primary-checkout absolute path silently edits `main` instead.

**Serena is unavailable in a worktree.** It binds to the primary checkout via `--project .`, so its symbol edits would land in the wrong tree. Use `rg` / Read / Edit throughout, including for Task 5's rename.

**Do not `git checkout --` or `git reset --hard` to undo a mutation check.** Edit the mutation back by hand.

**Task 5 and Task 6 are the two that can look done while being incomplete**, for opposite reasons: Task 5's codegen half is invisible to `tsc`, and Task 6's tests fail by timing out rather than asserting. Both have an explicit step above that checks the thing `tsc` and a green suite would miss.
