# Plan: public API surface (issue #260 findings 9, 7, 10)

**For agentic workers.** Each task below is self-contained: it lists exact files, interfaces, and complete code. Work inside the worktree at `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-public-surface` on branch `dx/260-public-surface`; all paths in this plan are repo-relative and resolve against that worktree root. Use worktree-prefixed absolute paths in Read/Edit/Write calls (never main-checkout paths). If the worktree has not been set up, run `pnpm wt:setup` first.

**Goal.** Close issue #260 findings 9, 7, and 10: re-export the hoofd head hooks from the framework surface, extend `createCaller` to streaming loaders/actions, and add a typed `eventStream` channel-payload generator, each validated by refactoring `apps/site` onto the new surface and synced into the docs.

**Architecture.** All three features land in `packages/iso` (the isomorphic core that `hono-preact` re-exports via `export * from '@hono-preact/iso'`). Finding 9 is a re-export plus a peer dependency; finding 7 is type-level overload work on `packages/iso/src/server-caller.ts` plus a small `signal` option (the runtime already passes generators through); finding 10 is a new `packages/iso/src/event-stream.ts` sibling of the internal coalescing `subscribe-topic.ts` that delivers payloads instead of discarding them. The site's demo activity feed and demo server tests are the validation consumers.

**Tech stack.** TypeScript (strict), Preact, Hono, vitest (root config aliases all `hono-preact` imports to package *source*, so unit tests never need a dist build), valibot (site schemas), MDX docs in `apps/site/src/pages/docs`.

**Task groups (independent; one stalling must not block the others):**

- Group A (finding 9): Tasks 1, 2, 3
- Group B (finding 7): Tasks 4, 5, 6 (Task 6 does not depend on Task 4)
- Group C (finding 10): Tasks 7, 8, 9 (Task 8 additionally consumes Task 4's streaming `call` surface)
- Task 10: batch verification

## Global Constraints

- **No em-dashes** in prose, code comments, commit messages, or docs. Use commas, colons, parentheses, or two sentences.
- **No inline type casts** (`as X`). Reshape types (type predicates, wider source types). Casts are acceptable ONLY at untrusted-JSON / FormData / user-module-export / untrusted-wire boundaries, and must carry a comment naming the boundary. This plan prescribes exactly one new cast (in `event-stream.ts`, at the pub/sub wire boundary) and retains the existing documented casts in `server-caller.ts`.
- **TDD**: every behavior task writes the failing test first, runs it to see it fail, implements minimally, re-runs to green, commits.
- **Docs sync**: every public-API task has a paired docs task in this plan. Docs describe what IS; never write "formerly X" / "replaces legacy Y" migration breadcrumbs.
- **Commits**: conventional-commit messages (`feat(scope):`, `fix(scope):`, `docs:`, `refactor(scope):`, `chore:`), each ending with the exact trailer line:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **Test commands**: unit tests run from the repo root via `pnpm vitest run <path>` (root `vitest.config.ts` aliases `hono-preact` and `@hono-preact/*` to source, so no build is needed for unit tests). Type-level tests run via `pnpm test:types`. `pnpm typecheck` and `pnpm --filter site build` resolve cross-package types through `dist/`, so run `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build` before either of those whenever `packages/*` sources changed.
- **Docs pages** follow `.claude/skills/add-docs-page.md`: guide template (prose lead, examples first, nuance second, API reference table last), entry in `apps/site/src/pages/docs/nav.ts`, verify with `pnpm vitest run apps/site/src/pages/docs/__tests__`.
- Do not push or open a PR from a task; the coordinator does that after Task 10.

---

## Task 1: iso: re-export the hoofd head hooks

The framework owns the hoofd integration (`packages/server/src/render.tsx` imports `HoofdProvider` from `hoofd/preact`; `hoofd` is a version-coupled peer of both `@hono-preact/server` and the `hono-preact` umbrella), but the user-facing hooks are not re-exported, so every page imports `'hoofd/preact'` directly. Re-export the six head hooks (and their option types) from `@hono-preact/iso`, following the existing convention for `preact-iso` re-exports (`packages/iso/src/index.ts` line 9 re-exports `Route`, `Router`, etc. directly, with `preact-iso` declared as an iso peer dependency). The `hono-preact` umbrella (`packages/hono-preact/src/index.ts` is `export * from '@hono-preact/iso'`) picks them up automatically, and `packages/hono-preact/scripts/consolidate.mjs` leaves non-`@hono-preact/*` import specifiers untouched, so `hoofd/preact` stays external in the published dist (it is already a peer of `hono-preact`).

**Files**

- Modify: `packages/iso/src/index.ts` (insert after the `ClientScript` export, currently line 203)
- Modify: `packages/iso/package.json` (add `hoofd` to `peerDependencies`)
- Test: `packages/iso/src/__tests__/public-exports.test.ts` (append a describe block)

**Interfaces**

Produces (new named exports on `@hono-preact/iso`, and therefore on `hono-preact`):

```ts
useTitle: (title: string, template?: boolean) => void
useTitleTemplate: (template: string) => void
useMeta: (options: MetaOptions) => void
useLink: (options: LinkOptions) => void
useLang: (language: string) => void
useScript: (options: ScriptOptions) => void
// plus type re-exports: MetaOptions, LinkOptions, ScriptOptions
```

**Steps**

- [ ] **Step 1: write the failing export test.** Append to `packages/iso/src/__tests__/public-exports.test.ts`:

```ts
describe('head management exports', () => {
  it('re-exports the hoofd head hooks', () => {
    expect(typeof iso.useTitle).toBe('function');
    expect(typeof iso.useTitleTemplate).toBe('function');
    expect(typeof iso.useMeta).toBe('function');
    expect(typeof iso.useLink).toBe('function');
    expect(typeof iso.useLang).toBe('function');
    expect(typeof iso.useScript).toBe('function');
  });
});
```

- [ ] **Step 2: run it and see it fail.** `pnpm vitest run packages/iso/src/__tests__/public-exports.test.ts` fails: `expected 'undefined' to be 'function'` for `useTitle`.

- [ ] **Step 3: add the peer dependency.** In `packages/iso/package.json`, change the `peerDependencies` block from:

```json
  "peerDependencies": {
    "hono": ">=4.0.0",
    "preact": ">=10.0.0",
    "preact-iso": ">=2.11.0"
  },
```

to:

```json
  "peerDependencies": {
    "hono": ">=4.0.0",
    "hoofd": ">=1.0.0",
    "preact": ">=10.0.0",
    "preact-iso": ">=2.11.0"
  },
```

Then run `pnpm install` from the repo root to sync the lockfile (pnpm auto-installs peers, matching how `@hono-preact/server` already resolves `hoofd/preact` with a peer-only declaration).

- [ ] **Step 4: add the re-export.** In `packages/iso/src/index.ts`, immediately after the line `export { ClientScript } from './client-script.js';`, insert:

```ts
// Head management hooks: trivial re-exports of hoofd/preact. The framework
// owns the hoofd integration (renderPage collects these into the document
// head via HoofdProvider), so pages import the hooks from hono-preact rather
// than depending on hoofd directly.
export {
  useTitle,
  useTitleTemplate,
  useMeta,
  useLink,
  useLang,
  useScript,
} from 'hoofd/preact';
export type { MetaOptions, LinkOptions, ScriptOptions } from 'hoofd/preact';
```

- [ ] **Step 5: re-run to green.** `pnpm vitest run packages/iso/src/__tests__/public-exports.test.ts` passes.

- [ ] **Step 6: verify the dist flow.** Run `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`, then confirm the consolidated umbrella dist still imports hoofd externally: `grep -n "hoofd/preact" packages/hono-preact/dist/iso/index.js` should show `export { ... } from 'hoofd/preact'` (an unrewritten external specifier). Also run `pnpm typecheck`.

- [ ] **Step 7: commit.**

```
git add packages/iso/src/index.ts packages/iso/package.json packages/iso/src/__tests__/public-exports.test.ts pnpm-lock.yaml
git commit -m "feat(iso): re-export the hoofd head hooks from the framework surface

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: site: import the head hooks from hono-preact

Sweep the five `apps/site` files that import from `'hoofd/preact'` onto the framework re-export from Task 1. Keep `hoofd` in `apps/site/package.json` dependencies: the app still supplies the framework's `hoofd` peer.

**Files**

- Modify: `apps/site/src/pages/home.tsx` (line 2)
- Modify: `apps/site/src/pages/not-found.tsx` (line 2)
- Modify: `apps/site/src/pages/demo/projects.tsx` (lines 1 and 3)
- Modify: `apps/site/src/pages/demo/task.tsx` (lines 1-9 and 12)
- Modify: `apps/site/src/pages/demo/project-header.tsx` (lines 3 and 4)

**Interfaces**

Consumes: `useTitle`, `useMeta` from `hono-preact` (added in Task 1). No signature changes; import-specifier moves only.

**Steps**

- [ ] **Step 1: verify Task 1 landed.** `git log --oneline -5` must show the Task 1 commit (the re-export exists in `packages/iso/src/index.ts`). Vitest and site typecheck resolve it from source/dist respectively.

- [ ] **Step 2: apply the five edits.**

  1. `apps/site/src/pages/home.tsx`: replace line 2 `import { useMeta, useTitle } from 'hoofd/preact';` with `import { useMeta, useTitle } from 'hono-preact';`
  2. `apps/site/src/pages/not-found.tsx`: replace line 2 `import { useTitle } from 'hoofd/preact';` with `import { useTitle } from 'hono-preact';`
  3. `apps/site/src/pages/demo/projects.tsx`: replace line 1 `import { definePage } from 'hono-preact';` with `import { definePage, useTitle } from 'hono-preact';` and delete line 3 `import { useTitle } from 'hoofd/preact';`
  4. `apps/site/src/pages/demo/task.tsx`: in the multi-line `from 'hono-preact'` import (lines 1-9), add `useTitle,` after `useReload,` so the list reads `definePage, Form, useFormStatus, useOptimisticAction, useParams, useReload, useTitle, ViewTransitionName`; delete line 12 `import { useTitle } from 'hoofd/preact';`
  5. `apps/site/src/pages/demo/project-header.tsx`: replace line 3 `import { useParams, useViewTransitionLifecycle } from 'hono-preact';` with `import { useParams, useTitle, useViewTransitionLifecycle } from 'hono-preact';` and delete line 4 `import { useTitle } from 'hoofd/preact';`

- [ ] **Step 3: verify no direct imports remain.** `grep -rn "hoofd/preact" apps/site/src` returns nothing.

- [ ] **Step 4: verify types and tests.** Run `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build` (fresh dist so the site sees the new exports), then `pnpm typecheck`, then `pnpm vitest run apps/site/src`. All green.

- [ ] **Step 5: commit.**

```
git add apps/site/src/pages/home.tsx apps/site/src/pages/not-found.tsx apps/site/src/pages/demo/projects.tsx apps/site/src/pages/demo/task.tsx apps/site/src/pages/demo/project-header.tsx
git commit -m "refactor(site): import head hooks from hono-preact

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: docs: Head Management page

The head hooks are now public framework API and have no docs page (docs mention them only in passing in `render-page.mdx`). Add a guide page at `/docs/head`, register it in the nav, and update the `render-page.mdx` example to import from `hono-preact`. Follow `.claude/skills/add-docs-page.md` (guide template) and the writing rules in `apps/site/BRAND.md`.

**Files**

- Create: `apps/site/src/pages/docs/head.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts` (Pages & Routing section, after the `Adding Pages` entry)
- Modify: `apps/site/src/pages/docs/render-page.mdx` (lines 34-42, the "Head tags" section example)

**Interfaces**

Documents: `useTitle(title, template?)`, `useTitleTemplate(template)`, `useMeta(options)`, `useLink(options)`, `useLang(language)`, `useScript(options)`, all imported from `hono-preact`.

**Steps**

- [ ] **Step 1: create the page.** Write `apps/site/src/pages/docs/head.mdx` with this content:

````mdx
# Head Management

Pages declare their document title, meta tags, link tags, and the `<html lang>` attribute with head hooks imported from `hono-preact`. During SSR the framework collects every hook call made in the rendered tree and injects the tags into the document head, so titles and social metadata are present in the initial HTML; on the client the same hooks keep the head in sync as the user navigates.

## Example

Set a title and description from any page component:

```tsx
// src/pages/movie.tsx
import { useTitle, useMeta } from 'hono-preact';

export default function Movie({ movie }: { movie: { title: string } }) {
  useTitle(movie.title);
  useMeta({ name: 'description', content: `Details for ${movie.title}` });
  return <h1>{movie.title}</h1>;
}
```

Set a site-wide title template once in a layout, and page titles slot into it:

```tsx
// src/pages/layout.tsx
import { useTitleTemplate, useLang } from 'hono-preact';

export default function Layout({ children }) {
  useTitleTemplate('%s | My App');
  useLang('en');
  return <>{children}</>;
}
```

Add a link tag (a canonical URL, a preload, an icon):

```tsx
import { useLink } from 'hono-preact';

useLink({ rel: 'canonical', href: 'https://example.com/movies' });
```

## How it works

- **SSR injection.** `renderPage` collects every head hook call during prerender and post-processes the tags into your layout's `</head>`. Your `Layout` must render a real `<head>` element (the `<Head>` component from `hono-preact` provides one); with no `<head>` in the output there is nowhere to inject and the tags are dropped.
- **Fallback title.** When no page sets a title, the `<Head defaultTitle="...">` prop (or `renderPage`'s `defaultTitle` option) supplies one.
- **Client navigation.** The hooks run on the client too: navigating to a page that calls `useTitle` updates `document.title` without a reload, and unmounting restores the previous value.
- **Deepest call wins.** When a layout and a page both set the same field, the innermost (most recently rendered) hook call takes effect, so page-level titles override layout defaults.

## API reference

| Hook | Signature | Description |
| ---- | --------- | ----------- |
| `useTitle` | `(title: string, template?: boolean) => void` | Sets `document.title`. Pass `template: true` to treat the string as a title template. |
| `useTitleTemplate` | `(template: string) => void` | Declares a title template; `%s` is replaced by the current `useTitle` value. |
| `useMeta` | `(options: MetaOptions) => void` | Renders a `<meta>` tag. `MetaOptions` carries `name`, `property` (Open Graph), `httpEquiv`, `charset`, and `content`. |
| `useLink` | `(options: LinkOptions) => void` | Renders a `<link>` tag. `LinkOptions` carries `rel` (required), `href`, `as`, `media`, `sizes`, `crossorigin`, `type`, and `hreflang`. |
| `useLang` | `(language: string) => void` | Sets the `lang` attribute on `<html>`. |
| `useScript` | `(options: ScriptOptions) => void` | Renders a `<script>` tag. `ScriptOptions` carries `src`, `id`, `text`, `type`, `async`, `defer`, `module`, `crossorigin`, and `integrity`. |

The option types (`MetaOptions`, `LinkOptions`, `ScriptOptions`) are exported from `hono-preact`.

See also: [renderPage](/docs/render-page) for how collected tags are injected server-side.
````

- [ ] **Step 2: register the nav entry.** In `apps/site/src/pages/docs/nav.ts`, in the `Pages & Routing` section's `entries` array, insert after `{ title: 'Adding Pages', route: '/docs/pages' },`:

```ts
          { title: 'Head Management', route: '/docs/head' },
```

- [ ] **Step 3: update render-page.mdx.** In `apps/site/src/pages/docs/render-page.mdx`, in the "Head tags" section, change the sentence on line 34 from `Pages set them with hoofd's \`useTitle\`, \`useMeta\`, and \`useLink\` hooks:` to `Pages set them with the \`useTitle\`, \`useMeta\`, and \`useLink\` hooks (see [Head Management](/docs/head)):` and in the code block below it change `import { useTitle } from 'hoofd/preact';` to `import { useTitle } from 'hono-preact';`.

- [ ] **Step 4: verify.** `pnpm vitest run apps/site/src/pages/docs/__tests__` passes (route/nav parity and page-structure ordering). Heed any `docs-template-check` hook stderr warnings and fix.

- [ ] **Step 5: commit.**

```
git add apps/site/src/pages/docs/head.mdx apps/site/src/pages/docs/nav.ts apps/site/src/pages/docs/render-page.mdx
git commit -m "docs: add Head Management page for the framework head hooks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: iso: extend createCaller to streaming loaders and actions

`ServerCaller.call` (`packages/iso/src/server-caller.ts` lines 28-37) is typed for `LoaderRef<T, false>` and `ActionRef<TPayload, TResult, never>` only, so streaming refs are excluded on both axes. The runtime already passes async generators through (an AsyncGenerator fn's call returns the generator synchronously inside the middleware dispatch, exactly like the HTTP handler in `packages/server/src/loaders-handler.ts` lines 314-396, where the SSE pump iterates OUTSIDE `dispatchServer`). Add streaming overloads and a caller-supplied `signal` option so a test can abort the stream it drains.

**Files**

- Modify: `packages/iso/src/server-caller.ts`
- Test: `packages/iso/src/__tests__/server-caller.test.ts` (append a describe block)
- Create (type tests): `packages/iso/src/__tests__/server-caller.test-d.ts`

**Interfaces**

New public types and the extended `ServerCaller` (all in `server-caller.ts`, re-exported from `index.ts` where noted):

```ts
export type CallLoaderOptions = { location?: CallLoaderLocation };
export type CallStreamOptions = CallLoaderOptions & { signal?: AbortSignal };

export interface ServerCaller {
  call<T>(loader: LoaderRef<T, true>, opts?: CallStreamOptions): Promise<CallResult<AsyncGenerator<T, void, unknown>>>;
  call<T>(loader: LoaderRef<T, false>, opts?: CallLoaderOptions): Promise<CallResult<T>>;
  call<TPayload, TResult>(action: ActionRef<TPayload, TResult, never>, payload: TPayload): Promise<CallResult<TResult>>;
  call<TPayload, TResult, TChunk>(action: ActionRef<TPayload, TResult, TChunk>, payload: TPayload): Promise<CallResult<AsyncGenerator<TChunk, TResult, unknown>>>;
}
```

Overload order is load-bearing: the streaming loader overload is first (mirroring `defineLoader`; a `LoaderRef<T, false>` cannot match it because its `useData` is a function, not `never`), and the non-streaming action overload precedes the streaming one (otherwise `ActionRef<P, R, never>` would match the generic streaming overload with `TChunk` inferred as `never`).

**Steps**

- [ ] **Step 1: write the failing runtime tests.** Append to `packages/iso/src/__tests__/server-caller.test.ts` (the file already imports `createCaller`, `defineLoader`, `defineAction`, `defineServerMiddleware`, `deny`, and defines the `ctx()` helper):

```ts
describe('createCaller streaming', () => {
  it('returns the async generator from a streaming loader and drains it', async () => {
    const c = await ctx();
    const stream = defineLoader(async function* () {
      yield 1;
      yield 2;
    });
    const r = await createCaller(c).call(stream);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const got: number[] = [];
      for await (const chunk of r.value) got.push(chunk);
      expect(got).toEqual([1, 2]);
    }
  });

  it('short-circuits a streaming loader on a middleware deny (the body never starts)', async () => {
    const c = await ctx();
    let ran = false;
    const guard = defineServerMiddleware(async () => deny('FORBIDDEN'));
    const stream = defineLoader(
      async function* () {
        ran = true;
        yield 1;
      },
      { use: [guard] }
    );
    const r = await createCaller(c).call(stream);
    expect(r.ok).toBe(false);
    if (!r.ok && r.outcome.__outcome === 'deny')
      expect(r.outcome.code).toBe('FORBIDDEN');
    expect(ran).toBe(false);
  });

  it('threads opts.signal into ctx.signal so an abort ends a parked stream', async () => {
    const c = await ctx();
    const stream = defineLoader(async function* ({ signal }) {
      yield 'first';
      // Park until the signal aborts, then finish (subscription-style loop).
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });
    const ctrl = new AbortController();
    const r = await createCaller(c).call(stream, { signal: ctrl.signal });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const first = await r.value.next();
      expect(first.value).toBe('first');
      const parked = r.value.next();
      ctrl.abort();
      const end = await parked;
      expect(end.done).toBe(true);
    }
  });

  it('returns the async generator from a streaming action (chunks, then the return value)', async () => {
    const c = await ctx();
    const act = defineAction(async function* (_ctx, p: { n: number }) {
      yield p.n;
      yield p.n + 1;
      return { total: p.n * 2 + 1 };
    });
    const r = await createCaller(c).call(act, { n: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const chunks: number[] = [];
      let step = await r.value.next();
      while (!step.done) {
        chunks.push(step.value);
        step = await r.value.next();
      }
      expect(chunks).toEqual([1, 2]);
      expect(step.value).toEqual({ total: 3 });
    }
  });
});
```

- [ ] **Step 2: run and see them fail.** `pnpm vitest run packages/iso/src/__tests__/server-caller.test.ts`. Vitest strips types, so the runtime red is the `opts.signal` test: the option is not threaded today, so the parked `next()` never resolves and the test times out. The overload rejections (streaming refs not accepted by `call`) are type-level reds: they surface when this file is typechecked, which Step 5's `pnpm test:types` run and Step 6's `pnpm typecheck` cover. Confirm the `opts.signal` test fails before implementing.

- [ ] **Step 3: write the failing type tests.** Create `packages/iso/src/__tests__/server-caller.test-d.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest';
import type { Context } from 'hono';
import { createCaller, type CallResult } from '../server-caller.js';
import { defineLoader } from '../define-loader.js';
import { defineAction } from '../action.js';

declare const c: Context;

describe('createCaller type surface', () => {
  it('types a single-value loader call as CallResult<T>', () => {
    const movie = defineLoader(async () => ({ title: 'Dune' }));
    expectTypeOf(createCaller(c).call(movie)).resolves.toEqualTypeOf<
      CallResult<{ title: string }>
    >();
  });

  it('types a streaming loader call as CallResult<AsyncGenerator<T>>', () => {
    const stream = defineLoader(async function* () {
      yield Math.random();
    });
    expectTypeOf(createCaller(c).call(stream)).resolves.toEqualTypeOf<
      CallResult<AsyncGenerator<number, void, unknown>>
    >();
  });

  it('types a non-streaming action call as CallResult<TResult>', () => {
    const act = defineAction(async (_ctx, p: { x: number }) => ({ y: p.x }));
    expectTypeOf(createCaller(c).call(act, { x: 1 })).resolves.toEqualTypeOf<
      CallResult<{ y: number }>
    >();
  });

  it('types a streaming action call as CallResult<AsyncGenerator<TChunk, TResult>>', () => {
    const act = defineAction(async function* (_ctx, p: { x: number }) {
      yield String(p.x);
      return { y: p.x };
    });
    expectTypeOf(createCaller(c).call(act, { x: 1 })).resolves.toEqualTypeOf<
      CallResult<AsyncGenerator<string, { y: number }, unknown>>
    >();
  });
});
```

Run `pnpm test:types` and confirm the two streaming assertions fail.

- [ ] **Step 4: implement.** In `packages/iso/src/server-caller.ts`:

  (a) Replace the `CallLoaderLocation` block and `ServerCaller` interface (currently lines 22-37) with:

```ts
export type CallLoaderLocation = {
  path?: string;
  pathParams?: Record<string, string>;
  searchParams?: Record<string, string>;
};

/** Options for calling a single-value loader. */
export type CallLoaderOptions = { location?: CallLoaderLocation };

/**
 * Options for calling a streaming loader. `signal` is composed with the
 * request's own signal (`AbortSignal.any`) and threaded to the loader as
 * `ctx.signal`, so a caller (typically a test) can abort the stream it is
 * draining.
 */
export type CallStreamOptions = CallLoaderOptions & { signal?: AbortSignal };

// Overload order is load-bearing. The streaming loader overload is listed
// FIRST (mirroring defineLoader); a LoaderRef<T, false> cannot match it
// because its useData is a function, never assignable to `never`. The
// non-streaming action overload precedes the streaming one: an
// ActionRef<P, R, never> would otherwise match the generic streaming overload
// with TChunk inferred as never.
export interface ServerCaller {
  /**
   * Call a streaming loader. Middleware and schema coercion run when the
   * generator is PRODUCED; iterating the returned generator runs the loader
   * body. This mirrors the HTTP handler, where the SSE pump iterates outside
   * the middleware dispatch (and outside the request scope), so an error
   * thrown mid-stream propagates from the generator, not as an outcome.
   */
  call<T>(
    loader: LoaderRef<T, true>,
    opts?: CallStreamOptions
  ): Promise<CallResult<AsyncGenerator<T, void, unknown>>>;
  call<T>(
    loader: LoaderRef<T, false>,
    opts?: CallLoaderOptions
  ): Promise<CallResult<T>>;
  call<TPayload, TResult>(
    action: ActionRef<TPayload, TResult, never>,
    payload: TPayload
  ): Promise<CallResult<TResult>>;
  /**
   * Call a streaming action. Iterate the returned generator for its chunks;
   * the generator's return value (the final `next()`'s `value` when `done`)
   * is the action's `TResult`.
   */
  call<TPayload, TResult, TChunk>(
    action: ActionRef<TPayload, TResult, TChunk>,
    payload: TPayload
  ): Promise<CallResult<AsyncGenerator<TChunk, TResult, unknown>>>;
}
```

  (b) Widen the loader-ref predicate (currently lines 66-70) so streaming refs flow through with no lie about liveness:

```ts
function isLoaderRef(ref: unknown): ref is LoaderRef<unknown, boolean> {
  return (
    typeof ref === 'object' && ref !== null && 'fn' in ref && '__id' in ref
  );
}
```

  (c) Update `createCaller` (currently lines 72-90) to forward the whole opts object:

```ts
export function createCaller(c: Context): ServerCaller {
  const caller: ServerCaller = {
    call: ((ref: unknown, arg?: unknown) =>
      isLoaderRef(ref)
        ? callLoader(
            c,
            caller,
            ref,
            // The erased-impl seam: the public overloads guarantee this shape.
            arg as CallStreamOptions | undefined
          )
        : callAction(
            c,
            caller,
            ref as ServerActionView,
            arg
          )) as ServerCaller['call'],
  };
  return caller;
}
```

  (d) Update `callLoader` (currently lines 101-148) to accept opts and compose the signal. Replace its signature and the two `signal` reads:

```ts
async function callLoader<T>(
  c: Context,
  caller: ServerCaller,
  ref: LoaderRef<T, boolean>,
  opts: CallStreamOptions | undefined
): Promise<CallResult<T>> {
  const location = opts?.location;
  // Compose the caller-supplied signal (streaming calls: lets the caller abort
  // the stream it is draining) with the request's own signal.
  const signal = opts?.signal
    ? AbortSignal.any([c.req.raw.signal, opts.signal])
    : c.req.raw.signal;
  const serverMw = serverMiddleware(ref.use);
  const ctx: ServerLoaderCtx = {
    scope: 'loader',
    c,
    signal,
    location: {
      path: location?.path ?? c.req.path,
      pathParams: location?.pathParams ?? {},
      searchParams: location?.searchParams ?? {},
    },
    module: ref.__moduleKey ?? '',
    loader: ref.__loaderName ?? '',
  };
  ...
```

  The rest of `callLoader` is unchanged except that the `ctx.signal` it already threads into `ref.fn({ ..., signal: ctx.signal, ... })` now carries the composed signal. `callAction` is unchanged (the streaming action generator flows through `await ref(...)` unchanged; awaiting a generator object is identity, and `isOutcome(generator)` is false).

- [ ] **Step 5: re-run to green.** `pnpm vitest run packages/iso/src/__tests__/server-caller.test.ts` passes (all pre-existing tests plus the four new ones). `pnpm test:types` passes. Then run the full iso suite as a regression check: `pnpm vitest run packages/iso`.

- [ ] **Step 6: export the new option types.** In `packages/iso/src/index.ts`, extend the existing server-caller type export (currently lines 58-62) to:

```ts
export type {
  ServerCaller,
  CallResult,
  CallLoaderLocation,
  CallLoaderOptions,
  CallStreamOptions,
} from './server-caller.js';
```

Re-run `pnpm vitest run packages/iso/src/__tests__/public-exports.test.ts` (unchanged expectations, sanity only) and `pnpm typecheck` after `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`.

- [ ] **Step 7: commit.**

```
git add packages/iso/src/server-caller.ts packages/iso/src/index.ts packages/iso/src/__tests__/server-caller.test.ts packages/iso/src/__tests__/server-caller.test-d.ts
git commit -m "feat(iso): extend createCaller to streaming loaders and actions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: docs: server-caller.mdx streaming section

`apps/site/src/pages/docs/server-caller.mdx` documents `createCaller` and currently states "Single-value loaders and actions only" under Limitations. Update it for the Task 4 surface.

**Files**

- Modify: `apps/site/src/pages/docs/server-caller.mdx`

**Steps**

- [ ] **Step 1: add a streaming section.** Insert a new `## Streaming loaders and actions` section immediately after the `## Testing with `createCaller(c)`` section (before `## How it works`):

````mdx
## Streaming loaders and actions

Streaming refs are first-class through the same `call` surface. Calling a streaming loader runs its middleware and schema coercion up front, then resolves to the loader's async generator; iterate it to run the loader body. Pass `signal` to end the stream from the caller's side:

```ts
import { createCaller } from 'hono-preact';
import { serverLoaders } from './projects-shell.server.js';

it('streams activity events', async () => {
  const ctrl = new AbortController();
  const r = await createCaller(c).call(serverLoaders.activity, {
    signal: ctrl.signal,
  });
  expect(r.ok).toBe(true);
  if (r.ok) {
    const events = [];
    for await (const e of r.value) {
      events.push(e);
      if (events.length === 3) break;
    }
    ctrl.abort();
  }
});
```

A middleware `deny` or `redirect` still surfaces as `{ ok: false, outcome }` before the generator is produced. An error thrown mid-stream propagates from the generator itself (a rejected `next()`), matching the HTTP path where the SSE stream terminates.

A streaming action resolves to `AsyncGenerator<TChunk, TResult>`: iterate for chunks; the final `next()`'s `value` (when `done` is `true`) is the action's return value.
````

- [ ] **Step 2: fix the Limitations section.** Delete the bullet `- **Single-value loaders and actions only.** ... a live loader produces a stream, not a single return value.` from `## Limitations`. Keep the "No synthetic context minting" bullet.

- [ ] **Step 3: extend the API reference.** In `### `ctx.call(loader, opts?)``, replace the table with:

```mdx
| Argument        | Type                            | Description                                                                                                              |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `loader`        | `LoaderRef<T, false>` \| `LoaderRef<T, true>` | The loader to call. A single-value loader resolves to its value; a streaming loader resolves to its async generator. |
| `opts.location` | `CallLoaderLocation` (optional) | Path, path params, and search params for the loader's location. Defaults to the current request path with empty params.  |
| `opts.signal`   | `AbortSignal` (optional, streaming loaders) | Composed with the request's signal and threaded to the loader as `ctx.signal`; aborting it ends the stream.  |

Returns `Promise<CallResult<T>>` for a single-value loader, `Promise<CallResult<AsyncGenerator<T, void, unknown>>>` for a streaming loader.
```

And in the `### `ctx.call(action, payload)`` section, replace the current table and its `Returns` line (the table's `action` row currently reads `The single-value action to call. Streaming actions are excluded by the type.`) with:

```mdx
| Argument  | Type                                   | Description                                                                             |
| --------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| `action`  | `ActionRef<TPayload, TResult, TChunk>` | The action to call. A single-value action resolves to its result; a streaming action resolves to its async generator. |
| `payload` | `TPayload`                             | The action payload. Validated against the action's `input` schema when one is present.  |

Returns `Promise<CallResult<TResult>>` for a single-value action, `Promise<CallResult<AsyncGenerator<TChunk, TResult, unknown>>>` for a streaming action (an async generator handler with a chunk type).
```

- [ ] **Step 4: verify.** `pnpm vitest run apps/site/src/pages/docs/__tests__` passes.

- [ ] **Step 5: commit.**

```
git add apps/site/src/pages/docs/server-caller.mdx
git commit -m "docs: document streaming loader/action calls through createCaller

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: site: migrate the demo server tests onto createCaller

`apps/site/src/pages/demo/__tests__/task.server.test.ts` and `login.server.test.ts` bypass the type system: `serverActions.setStatus as unknown as ActionFn` (line 27), `serverActions.login as unknown as Function` plus structural `__outcome` probing (lines 26-32), and a fabricated `as unknown as LoaderCtx` (line 137). Rewrite both files onto `createCaller` and the exported `isDeny` / `isRedirect` predicates, deleting every cast. This task does NOT depend on Task 4: these loaders/actions are all non-streaming, so the existing `createCaller` surface suffices.

**Files**

- Modify (full rewrite): `apps/site/src/pages/demo/__tests__/login.server.test.ts`
- Modify (full rewrite): `apps/site/src/pages/demo/__tests__/task.server.test.ts`

**Interfaces**

Consumes from `hono-preact`: `createCaller`, `isDeny`, `isRedirect`, `type CallResult`, `type InferActionPayload`, `type InferActionResult` (all already exported). Under test: `serverActions.login` is `ActionRef<{ email: string; name: string }, never, never>`; `serverActions.setStatus` is a route-bound `ActionRef<{ taskId: string; status: TaskStatus }, { ok: true }, never>` (payload inferred from `SetStatusSchema`); `serverLoaders.task` is a route-bound `LoaderRef<TaskDetail | null, false>`.

**Steps**

- [ ] **Step 1: rewrite login.server.test.ts.** Replace the entire file with:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createCaller, isRedirect } from 'hono-preact';
import { serverActions } from '../login.server.js';
import { resetDemoData, findUserByEmail } from '../../../demo/data.js';
import { DEMO_SESSION_COOKIE } from '../../../demo/session.js';

// Run `fn` inside a real Hono request so the action sees a live Context
// (signIn writes the session cookie onto c.res).
async function inRequest<T>(fn: (c: Context) => Promise<T>): Promise<T> {
  const app = new Hono();
  let result!: T;
  app.post('/', async (c) => {
    result = await fn(c);
    return c.text('ok');
  });
  const res = await app.request('/', { method: 'POST' });
  expect(res.status).toBe(200);
  return result;
}

describe('login action', () => {
  beforeEach(() => resetDemoData());

  it('upserts the user, sets a session cookie, and redirects to the projects list', async () => {
    const captured = await inRequest(async (c) => {
      const r = await createCaller(c).call(serverActions.login, {
        email: 'newuser@example.com',
        name: 'New User',
      });
      return { r, cookieSet: c.res.headers.get('set-cookie') };
    });
    expect(captured.r.ok).toBe(false);
    if (!captured.r.ok) {
      expect(isRedirect(captured.r.outcome)).toBe(true);
      if (isRedirect(captured.r.outcome)) {
        expect(captured.r.outcome.to).toBe('/demo/projects');
      }
    }
    expect(findUserByEmail('newuser@example.com')?.name).toBe('New User');
    expect(captured.cookieSet).toMatch(new RegExp(`${DEMO_SESSION_COOKIE}=`));
  });

  it('rejects an empty email', async () => {
    const threw = await inRequest(async (c) => {
      try {
        await createCaller(c).call(serverActions.login, {
          email: '',
          name: '',
        });
        return null;
      } catch (e) {
        return e instanceof Error ? e : new Error(String(e));
      }
    });
    expect(threw).not.toBe(null);
    expect(threw?.message).toMatch(/email/i);
  });
});
```

- [ ] **Step 2: run it.** `pnpm vitest run apps/site/src/pages/demo/__tests__/login.server.test.ts`. Both tests pass (this is a refactor of test plumbing onto an existing surface; the observable behavior assertions are unchanged, so green immediately is the expected outcome; if anything fails, fix the test plumbing, not the action).

- [ ] **Step 3: rewrite task.server.test.ts.** Replace the entire file with:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  createCaller,
  isDeny,
  type CallResult,
  type InferActionPayload,
  type InferActionResult,
} from 'hono-preact';
import {
  serverActions,
  serverLoaders,
  type TaskDetail,
} from '../task.server.js';
import {
  resetDemoData,
  upsertUser,
  listTasksForProject,
  getProjectBySlug,
  getTask,
} from '../../../demo/data.js';
import { signIn } from '../../../demo/session.js';

type SetStatusInput = InferActionPayload<typeof serverActions.setStatus>;
type SetStatusResult = InferActionResult<typeof serverActions.setStatus>;

// A cookie set on the response is not readable on the same request, so the
// session cookie is minted in a first round-trip and replayed as a request
// header on the action call (currentUser reads it off c.req).
async function mintSessionCookie(user: {
  id: string;
  email: string;
  name: string;
}): Promise<string> {
  const app = new Hono();
  app.post('/login', async (c) => {
    await signIn(c, user);
    return c.text('ok');
  });
  const res = await app.request('/login', { method: 'POST' });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('expected a session cookie');
  // Strip attributes (Path, HttpOnly, ...); keep just `name=value`.
  return setCookie.split(';')[0];
}

// Run setStatus through createCaller inside a real Hono request so currentUser
// can read the signed session cookie. `signedInAs` mints + replays the cookie.
async function runSetStatus(
  input: SetStatusInput,
  signedInAs?: { id: string; email: string; name: string }
): Promise<CallResult<SetStatusResult>> {
  const cookie = signedInAs ? await mintSessionCookie(signedInAs) : null;
  const app = new Hono();
  let result!: CallResult<SetStatusResult>;
  app.post('/', async (c) => {
    result = await createCaller(c).call(serverActions.setStatus, input);
    return c.text('ok');
  });
  const res = await app.request('/', {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  });
  expect(res.status).toBe(200);
  return result;
}

describe('task setStatus action', () => {
  beforeEach(() => resetDemoData());

  it('moves a task to a non-Done status without an author check', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find((t) => t.status !== 'done')!;

    const r = await runSetStatus({ taskId: task.id, status: 'in_review' });

    expect(r.ok).toBe(true);
    expect(getTask(task.id)?.status).toBe('in_review');
  });

  it('denies moving to Done for a non-author non-assignee', async () => {
    const stranger = upsertUser('stranger@example.com', 'Stranger');
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find(
      (t) => t.assigneeId === null && t.status !== 'done'
    )!;

    const r = await runSetStatus({ taskId: task.id, status: 'done' }, stranger);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) {
        expect(r.outcome.status).toBe(403);
        expect(r.outcome.message).toMatch(/author|assignee/i);
      }
    }
    // The deny short-circuits before the write, so status is unchanged.
    expect(getTask(task.id)?.status).not.toBe('done');
  });

  it('allows the author to move a task to Done', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find((t) => t.status !== 'done')!;
    const author = upsertUser('author@example.com', 'Author');
    // Re-seed authorId so the signed-in user is the author of this task.
    task.authorId = author.id;

    const r = await runSetStatus({ taskId: task.id, status: 'done' }, author);

    expect(r.ok).toBe(true);
    expect(getTask(task.id)?.status).toBe('done');
  });
});

// The detail hero mirrors the board card (assignee avatar included), so the task
// loader must resolve the assignee User, not just the author.
describe('task loader', () => {
  beforeEach(() => resetDemoData());

  const loadTask = async (taskId: string): Promise<TaskDetail | null> => {
    const app = new Hono();
    let result!: CallResult<TaskDetail | null>;
    app.get('/', async (c) => {
      result = await createCaller(c).call(serverLoaders.task, {
        location: { pathParams: { taskId } },
      });
      return c.text('ok');
    });
    await app.request('/');
    if (!result.ok) throw new Error('expected the task loader to succeed');
    return result.value;
  };

  it('resolves the assignee User alongside the author', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id)[0];
    const assignee = upsertUser('assignee@example.com', 'Assignee');
    task.assigneeId = assignee.id;

    const result = await loadTask(task.id);

    expect(result?.assignee?.id).toBe(assignee.id);
    expect(result?.assignee?.name).toBe('Assignee');
    // The author is still resolved on the same value.
    expect(result?.author?.id).toBe(task.authorId);
  });

  it('resolves a null assignee for an unassigned task', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id)[0];
    task.assigneeId = null;

    const result = await loadTask(task.id);

    expect(result?.assignee).toBeNull();
  });

  it('returns null for an unknown task id', async () => {
    expect(await loadTask('does-not-exist')).toBeNull();
  });
});
```

- [ ] **Step 4: run and verify.** `pnpm vitest run apps/site/src/pages/demo/__tests__/task.server.test.ts apps/site/src/pages/demo/__tests__/login.server.test.ts` passes. Then `grep -n "as unknown" apps/site/src/pages/demo/__tests__/task.server.test.ts apps/site/src/pages/demo/__tests__/login.server.test.ts` returns nothing.

- [ ] **Step 5: commit.**

```
git add apps/site/src/pages/demo/__tests__/login.server.test.ts apps/site/src/pages/demo/__tests__/task.server.test.ts
git commit -m "refactor(site): drive demo server tests through createCaller, dropping every cast

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: iso: add eventStream, a typed channel-payload generator

`subscribeTopic` (`packages/iso/src/internal/subscribe-topic.ts`, consumed only by `liveStream` at `packages/iso/src/server-route.ts:58`) is a coalescing wake: it discards the published payload. There is no public way to consume `publish()`ed payloads in a streaming loader, so the site hand-rolls a queue/wake/abort machine on a module-level bus that never crosses Cloudflare isolates. Add a public `eventStream(topic, signal)` that yields each published payload in order, typed from the `Topic<Payload>` brand, riding the same `getPubSubBackend()` fan-out (in-process on Node, the realtime Durable Object on Cloudflare).

The yield type is `Serialize<Payload>`, the framework's wire-shape convention: on Cloudflare the payload crosses the DO socket as JSON (see `packages/server/src/cf/cf-pubsub.ts`, `JSON.parse` in the subscribe message handler), so a `Date` published in one isolate arrives as its ISO string in another.

**Files**

- Create: `packages/iso/src/event-stream.ts`
- Modify: `packages/iso/src/index.ts` (Realtime channels section, after the `publish` export at line 119)
- Test: `packages/iso/src/__tests__/event-stream.test.ts` (new)
- Test: `packages/iso/src/__tests__/event-stream.test-d.ts` (new)
- Test: `packages/iso/src/__tests__/public-exports.test.ts` (extend the realtime describe)

**Interfaces**

```ts
export function eventStream<P>(
  topic: Topic<P>,
  signal: AbortSignal
): AsyncGenerator<Serialize<P>, void, unknown>;
```

Semantics: eager subscription at call time (a publish before the first pull is buffered, mirroring `subscribe-topic.ts`); FIFO unbounded buffering while the consumer is busy; abort ends iteration and unsubscribes (idempotent teardown wired to both the abort listener and the generator's `finally`); a backend-reported subscription drop throws out of the generator.

**Steps**

- [ ] **Step 1: write the failing tests.** Create `packages/iso/src/__tests__/event-stream.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eventStream } from '../event-stream.js';
import { publish } from '../pubsub.js';
import { defineChannel } from '../define-channel.js';
import {
  installPubSubBackend,
  __resetPubSubForTesting,
  type PubSubBackend,
} from '../internal/pubsub.js';

afterEach(() => {
  __resetPubSubForTesting();
});

describe('eventStream', () => {
  it('yields published payloads in publish order', async () => {
    const ch = defineChannel('es-order')<{ n: number }>();
    const ac = new AbortController();
    const gen = eventStream(ch.key(), ac.signal);
    const first = gen.next();
    publish(ch.key(), { n: 1 });
    publish(ch.key(), { n: 2 });
    expect((await first).value).toEqual({ n: 1 });
    expect((await gen.next()).value).toEqual({ n: 2 });
    ac.abort();
  });

  it('buffers a publish that lands before the first pull (eager subscription)', async () => {
    const ch = defineChannel('es-early')<{ n: number }>();
    const ac = new AbortController();
    const gen = eventStream(ch.key(), ac.signal);
    publish(ch.key(), { n: 7 });
    expect((await gen.next()).value).toEqual({ n: 7 });
    ac.abort();
  });

  it('ends when the signal aborts', async () => {
    const ch = defineChannel('es-abort')<{ n: number }>();
    const ac = new AbortController();
    const gen = eventStream(ch.key(), ac.signal);
    const parked = gen.next();
    ac.abort();
    expect((await parked).done).toBe(true);
  });

  it('unsubscribes on abort (a later publish does not revive the stream)', async () => {
    const ch = defineChannel('es-unsub')<{ n: number }>();
    const ac = new AbortController();
    const gen = eventStream(ch.key(), ac.signal);
    const parked = gen.next();
    ac.abort();
    await parked;
    publish(ch.key(), { n: 9 });
    expect((await gen.next()).done).toBe(true);
  });

  it('removes the subscription on abort even if the stream was never pulled', () => {
    let unsubbed = false;
    const fake: PubSubBackend = {
      publish() {},
      subscribe() {
        return () => {
          unsubbed = true;
        };
      },
    };
    installPubSubBackend(fake);
    const ac = new AbortController();
    eventStream(defineChannel('es-leak')<{ n: number }>().key(), ac.signal);
    ac.abort();
    expect(unsubbed).toBe(true);
  });

  it('throws out of the generator when the backend reports a drop', async () => {
    let failSub: ((error: unknown) => void) | undefined;
    const fake: PubSubBackend = {
      publish() {},
      subscribe(_topic, _onMessage, onError) {
        failSub = onError;
        return () => {};
      },
    };
    installPubSubBackend(fake);
    const ac = new AbortController();
    const gen = eventStream(
      defineChannel('es-drop')<{ n: number }>().key(),
      ac.signal
    );
    const parked = gen.next();
    failSub?.(new Error('socket died'));
    await expect(parked).rejects.toThrow('socket died');
    ac.abort();
  });
});
```

- [ ] **Step 2: run and see it fail.** `pnpm vitest run packages/iso/src/__tests__/event-stream.test.ts` fails: cannot resolve `../event-stream.js`.

- [ ] **Step 3: implement.** Create `packages/iso/src/event-stream.ts`:

```ts
import type { Topic } from './define-channel.js';
import type { Serialize } from './internal/serialize.js';
import { getPubSubBackend } from './internal/pubsub.js';

/**
 * Subscribe to a typed channel topic as an async generator of its published
 * payloads. The fine-grained sibling of `liveStream`: where `liveStream`
 * treats a publish as a "something changed, re-run load" wake and discards
 * the message, `eventStream` delivers every published payload, in order, to a
 * streaming loader that yields events (activity feeds, tickers, notification
 * bars). It rides the same pub/sub backend as `publish()`, so on Cloudflare
 * the events fan out across isolates through the realtime Durable Object.
 *
 * ```ts
 * const activityChannel = defineChannel('activity')<ActivityEvent>();
 *
 * export const serverLoaders = {
 *   activity: defineLoader(
 *     async function* ({ signal }) {
 *       for await (const e of eventStream(activityChannel.key(), signal)) {
 *         yield e;
 *       }
 *     },
 *     { live: true }
 *   ),
 * };
 * ```
 *
 * The yield type is `Serialize<P>` (the JSON wire shape): on Cloudflare the
 * payload crosses a Durable Object socket as JSON, so a `Date` published on
 * one isolate arrives as its ISO string on another. Publish JSON-shaped
 * payloads and the two are identical.
 *
 * The subscription is registered eagerly (at call time), so a publish landing
 * before the first pull is buffered, not missed. Payloads queue FIFO while
 * the consumer is busy (unbounded; a streaming loader drains continuously).
 * Teardown is idempotent and wired to BOTH the abort listener and the
 * generator's `finally`, so the subscription is removed when `signal` aborts
 * even if the iterable was never pulled. A backend-reported subscription drop
 * (e.g. a CF worker->DO topic socket dying) throws out of the generator so
 * the stream terminates instead of going silently stale.
 */
export function eventStream<P>(
  topic: Topic<P>,
  signal: AbortSignal
): AsyncGenerator<Serialize<P>, void, unknown> {
  const queue: Serialize<P>[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  // Boxed so a falsy error still reads as a drop; see subscribe-topic.ts
  // (this file's coalescing sibling) for the narrowing rationale.
  const drop: { failure: { error: unknown } | null } = { failure: null };

  const unsub = getPubSubBackend().subscribe(
    topic,
    (message) => {
      // The payload crossed the pub/sub backend as `unknown` (on Cloudflare
      // it is a JSON round-trip over the Durable Object socket). `Topic<P>`
      // binds the payload type at the publish site, so this is the sanctioned
      // untrusted-wire boundary where the type re-enters.
      queue.push(message as Serialize<P>);
      wake?.();
      wake = null;
    },
    (error) => {
      // The backend's subscription dropped. Record it and wake the generator
      // so it throws instead of hanging.
      drop.failure = { error };
      wake?.();
      wake = null;
    }
  );

  const teardown = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', onAbort);
    unsub();
  };
  function onAbort() {
    teardown();
    wake?.();
    wake = null;
  }

  signal.addEventListener('abort', onAbort);
  // Aborted before we attached: tear down immediately.
  if (signal.aborted) teardown();

  return (async function* () {
    try {
      while (!signal.aborted) {
        if (queue.length === 0 && !drop.failure) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (signal.aborted) break;
        const failure = drop.failure;
        if (failure) {
          throw failure.error instanceof Error
            ? failure.error
            : new Error('hono-preact: event stream subscription dropped');
        }
        while (queue.length > 0 && !signal.aborted) {
          // Length-checked and single-consumer, so shift() is defined.
          yield queue.shift()!;
        }
      }
    } finally {
      teardown();
    }
  })();
}
```

- [ ] **Step 4: export it.** In `packages/iso/src/index.ts`, in the `// Realtime channels.` section, after `export { publish } from './pubsub.js';`, add:

```ts
export { eventStream } from './event-stream.js';
```

And in `packages/iso/src/__tests__/public-exports.test.ts`, inside the existing `describe('realtime channel exports', ...)` block, extend the test body:

```ts
  it('exports eventStream', () => {
    expect(typeof iso.eventStream).toBe('function');
  });
```

- [ ] **Step 5: re-run to green.** `pnpm vitest run packages/iso/src/__tests__/event-stream.test.ts packages/iso/src/__tests__/public-exports.test.ts` passes. Also run the neighboring realtime suites as regression: `pnpm vitest run packages/iso/src/__tests__/live-stream.test.ts packages/iso/src/__tests__/pubsub.test.ts packages/iso/src/internal/__tests__/subscribe-topic.test.ts`.

- [ ] **Step 6: type tests.** Create `packages/iso/src/__tests__/event-stream.test-d.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest';
import { eventStream } from '../event-stream.js';
import { defineChannel } from '../define-channel.js';

describe('eventStream typing', () => {
  it('yields the channel payload in wire shape (Serialize<P>)', () => {
    const ch = defineChannel('board/:projectId')<{
      taskId: string;
      at: Date;
    }>();
    const gen = eventStream(
      ch.key({ projectId: 'p1' }),
      new AbortController().signal
    );
    // Date serializes to its ISO string on the wire.
    expectTypeOf(gen).toEqualTypeOf<
      AsyncGenerator<{ taskId: string; at: string }, void, unknown>
    >();
  });
});
```

Run `pnpm test:types`; it passes.

- [ ] **Step 7: commit.**

```
git add packages/iso/src/event-stream.ts packages/iso/src/index.ts packages/iso/src/__tests__/event-stream.test.ts packages/iso/src/__tests__/event-stream.test-d.ts packages/iso/src/__tests__/public-exports.test.ts
git commit -m "feat(iso): add eventStream for typed channel payloads in streaming loaders

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: site: move the demo activity feed onto the channel + eventStream

**Depends on Tasks 4 and 7** (the rewritten loader test drains the stream through `createCaller`'s streaming overload). Replace the site's hand-rolled bus (`apps/site/src/demo/activity-stream.ts` lines 87-108: `listeners` set, `publishActivity`, `subscribeActivity`) and the ~45-line queue/wake/timer/abort machine (`apps/site/src/pages/demo/projects-shell.server.ts` lines 22-64) with a typed `defineChannel` + `eventStream`. Move the simulated-teammate heartbeat publish-side into `activity-sim.ts` as a refcounted timer, acquired per connected stream.

Accepted behavior change (framework-validation intent of the finding): simulated events are now published on the shared channel, so all connected clients see the same fabricated events (previously each connection fabricated its own, only when its queue was idle), and real publishes now cross Cloudflare isolates.

**Files**

- Modify: `apps/site/src/demo/activity-stream.ts` (delete the bus, add the channel)
- Modify: `apps/site/src/demo/activity-sim.ts` (add the refcounted heartbeat)
- Modify: `apps/site/src/pages/demo/projects-shell.server.ts` (rewrite `activityStream`)
- Modify: `apps/site/src/pages/demo/task.server.ts` (publisher swap, lines 17-21, 92, 105-109)
- Modify: `apps/site/src/pages/demo/project-board.server.ts` (publisher swap, lines 17-21, 59, 79-83)
- Test (rewrite): `apps/site/src/demo/__tests__/activity-stream.test.ts`
- Test (extend): `apps/site/src/demo/__tests__/activity-sim.test.ts`
- Test (rewrite): `apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts`

**Interfaces**

New site exports:

```ts
// apps/site/src/demo/activity-stream.ts
export const activityChannel: Channel<'demo-activity', ActivityEvent>;
// apps/site/src/demo/activity-sim.ts
export function acquireSimHeartbeat(): () => void; // idempotent release
export function __resetSimHeartbeatForTesting(): void;
```

Deleted site exports: `publishActivity`, `subscribeActivity` (grep confirms the only consumers are the files modified here).

**Steps**

- [ ] **Step 1: write the failing channel test.** Rewrite `apps/site/src/demo/__tests__/activity-stream.test.ts` as:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { publish, eventStream } from 'hono-preact';
import { resetDemoData, getTask } from '../data.js';
import {
  activityChannel,
  taskMovedEvent,
  commentAddedEvent,
  taskCreatedEvent,
  recentActivityEvents,
  __resetActivityForTesting,
} from '../activity-stream.js';

beforeEach(() => {
  resetDemoData();
  __resetActivityForTesting();
});

describe('activity channel', () => {
  it('delivers published events to a channel subscriber', async () => {
    const ac = new AbortController();
    const gen = eventStream(activityChannel.key(), ac.signal);
    const first = gen.next();
    const task = getTask('t-1')!;
    publish(activityChannel.key(), taskMovedEvent(task, 'done', 'Alice'));
    const got = await first;
    expect(got.done).toBe(false);
    expect(got.value).toMatchObject({
      kind: 'task-moved',
      taskId: 't-1',
      to: 'done',
      actor: 'Alice',
      projectSlug: 'inf',
      simulated: false,
    });
    ac.abort();
  });

  it('assigns unique ids and marks simulated events', () => {
    const task = getTask('t-1')!;
    const a = taskCreatedEvent(task, 'Alice');
    const b = commentAddedEvent(task, 'Bob', true);
    expect(a.id).not.toBe(b.id);
    expect(a.simulated).toBe(false);
    expect(b.simulated).toBe(true);
  });
});

describe('recentActivityEvents', () => {
  it('returns up to `limit` well-formed events newest-first from the seed store', () => {
    const events = recentActivityEvents(5);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].at).toBeGreaterThanOrEqual(events[i].at);
    }
    for (const e of events) {
      expect(typeof e.taskTitle).toBe('string');
      expect(['inf', 'api', 'web']).toContain(e.projectSlug);
      expect(e.simulated).toBe(false);
    }
  });
});
```

Run `pnpm vitest run apps/site/src/demo/__tests__/activity-stream.test.ts`: fails (`activityChannel` is not exported).

- [ ] **Step 2: refactor activity-stream.ts.** In `apps/site/src/demo/activity-stream.ts`:

  (a) Add `import { defineChannel } from 'hono-preact';` at the top (after the header comment, before the `./data.js` import), and update the header comment's second paragraph to describe the channel: replace the lines

```
// In-memory activity bus + event model for the persistent demo activity bar.
// The bus is per-isolate: server actions publish real events; the SSE endpoint
// subscribes. Builders construct events; the data store stays a pure module and
// does not import this file.
```

  with

```
// Event model + typed channel for the persistent demo activity bar. Server
// actions publish real events on `activityChannel`; the shell's live loader
// subscribes via `eventStream`, so on Cloudflare the feed sees publishes from
// other isolates through the realtime Durable Object. Builders construct
// events; the data store stays a pure module and does not import this file.
```

  (b) After the `ActivityEvent` type declaration, add:

```ts
/** The typed channel demo activity rides. `publish(activityChannel.key(), e)`
 * from an action; `eventStream(activityChannel.key(), signal)` in the shell's
 * live loader. */
export const activityChannel = defineChannel('demo-activity')<ActivityEvent>();
```

  (c) Delete the bus block entirely (the `const listeners = new Set<...>` declaration and the `publishActivity` and `subscribeActivity` functions, currently lines 85-108).

  (d) Simplify the test reset to:

```ts
/** Test-only reset. Do not call from production code. */
export function __resetActivityForTesting(): void {
  counter = 0;
}
```

Re-run `pnpm vitest run apps/site/src/demo/__tests__/activity-stream.test.ts`: green.

- [ ] **Step 3: write the failing heartbeat test.** Append to `apps/site/src/demo/__tests__/activity-sim.test.ts` (keep the existing content; add imports as needed at the top: `vi`, `afterEach`, `beforeEach` from `'vitest'`, `eventStream` from `'hono-preact'`, `activityChannel` from `'../activity-stream.js'`, and `acquireSimHeartbeat`, `__resetSimHeartbeatForTesting` from `'../activity-sim.js'`):

```ts
describe('sim heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    __resetSimHeartbeatForTesting();
    vi.useRealTimers();
  });

  it('publishes a simulated event on the channel while held', async () => {
    const ac = new AbortController();
    const gen = eventStream(activityChannel.key(), ac.signal);
    const release = acquireSimHeartbeat();
    const first = gen.next();
    // The tick window is 4000-8000ms; 8000 guarantees one fire.
    await vi.advanceTimersByTimeAsync(8000);
    const got = await first;
    expect(got.done).toBe(false);
    expect(got.value).toMatchObject({ simulated: true });
    release();
    ac.abort();
  });

  it('is refcounted: the timer stops only when the last holder releases', () => {
    const releaseA = acquireSimHeartbeat();
    const releaseB = acquireSimHeartbeat();
    expect(vi.getTimerCount()).toBe(1);
    releaseA();
    expect(vi.getTimerCount()).toBe(1);
    releaseB();
    expect(vi.getTimerCount()).toBe(0);
    // A release is idempotent: calling it again must not go negative.
    releaseB();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

Run `pnpm vitest run apps/site/src/demo/__tests__/activity-sim.test.ts`: fails (`acquireSimHeartbeat` is not exported).

- [ ] **Step 4: implement the heartbeat.** In `apps/site/src/demo/activity-sim.ts`, add `import { publish } from 'hono-preact';` and extend the `./activity-stream.js` import to include `activityChannel`. Append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Heartbeat: while at least one activity stream is connected, publish a
// fabricated teammate event on the channel every 4-8 seconds so the demo bar
// always has motion. Refcounted so concurrent streams share one timer and the
// timer stops when the last stream disconnects.

let holders = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleTick(): void {
  timer = setTimeout(
    () => {
      const e = simulateActivity();
      if (e) publish(activityChannel.key(), e);
      if (holders > 0) scheduleTick();
    },
    4000 + Math.floor(Math.random() * 4000)
  );
}

/** Acquire the simulated-activity heartbeat. Returns an idempotent release. */
export function acquireSimHeartbeat(): () => void {
  holders++;
  if (holders === 1) scheduleTick();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    if (holders === 0 && timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

/** Test-only reset: drop all holders and any pending timer. */
export function __resetSimHeartbeatForTesting(): void {
  holders = 0;
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}
```

Re-run `pnpm vitest run apps/site/src/demo/__tests__/activity-sim.test.ts`: green.

- [ ] **Step 5: swap the publishers.** In `apps/site/src/pages/demo/task.server.ts`: add `publish` to the `hono-preact` import (line 1 becomes `import { serverRoute, publish } from 'hono-preact';`), change the activity-stream import block (lines 17-21) to `import { activityChannel, commentAddedEvent, taskMovedEvent } from '../../demo/activity-stream.js';`, replace line 92 `if (task) publishActivity(commentAddedEvent(task, user.name));` with `if (task) publish(activityChannel.key(), commentAddedEvent(task, user.name));`, and replace the `publishActivity(\n taskMovedEvent(task, input.status, user?.name ?? 'someone')\n );` call (lines 105-109) with `publish(\n activityChannel.key(),\n taskMovedEvent(task, input.status, user?.name ?? 'someone')\n );`.

  In `apps/site/src/pages/demo/project-board.server.ts`: line 1 becomes `import { defineAction, publish, serverRoute } from 'hono-preact';`, the activity-stream import block (lines 17-21) becomes `import { activityChannel, taskCreatedEvent, taskMovedEvent } from '../../demo/activity-stream.js';`, line 59 `publishActivity(taskCreatedEvent(created, user.name));` becomes `publish(activityChannel.key(), taskCreatedEvent(created, user.name));`, and the `publishActivity(\n taskMovedEvent(task, input.status, user?.name ?? 'someone')\n );` call (around lines 79-83) becomes `publish(\n activityChannel.key(),\n taskMovedEvent(task, input.status, user?.name ?? 'someone')\n );`.

  Verify: `grep -rn "publishActivity\|subscribeActivity" apps/site/src` returns nothing.

- [ ] **Step 6: rewrite the shell loader.** Replace `apps/site/src/pages/demo/projects-shell.server.ts` in full with:

```ts
import { defineLoader, eventStream, type LoaderCtx } from 'hono-preact';
import {
  listProjects,
  listTasksForProject,
  type Project,
  type User,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';
import {
  activityChannel,
  recentActivityEvents,
  type ActivityEvent,
} from '../../demo/activity-stream.js';
import { acquireSimHeartbeat } from '../../demo/activity-sim.js';

export type ShellData = {
  user: User | null;
  projects: (Project & { taskCount: number })[];
};

// Backfill recent history, then stream every event published on the activity
// channel. The channel rides the framework's pub/sub layer, so on Cloudflare
// the feed sees publishes from other isolates. The heartbeat keeps fabricated
// teammate events flowing while at least one stream is connected.
async function* activityStream({
  signal,
}: LoaderCtx): AsyncGenerator<ActivityEvent, void, unknown> {
  for (const e of recentActivityEvents(5)) yield e;
  const release = acquireSimHeartbeat();
  try {
    for await (const e of eventStream(activityChannel.key(), signal)) {
      yield e;
    }
  } finally {
    release();
  }
}

export const serverLoaders = {
  default: defineLoader(async (ctx) => {
    const user = await currentUser(ctx.c);
    const projects = listProjects().map((p) => ({
      ...p,
      taskCount: listTasksForProject(p.id).length,
    }));
    return { user, projects } satisfies ShellData;
  }),
  activity: defineLoader(activityStream, { live: true }),
};
```

- [ ] **Step 7: rewrite the shell loader test onto the sanctioned streaming path.** Replace `apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts` in full with:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createCaller, publish } from 'hono-preact';
import { serverLoaders } from '../projects-shell.server.js';
import {
  activityChannel,
  taskMovedEvent,
} from '../../../demo/activity-stream.js';
import { resetDemoData, getTask } from '../../../demo/data.js';
import { __resetSimHeartbeatForTesting } from '../../../demo/activity-sim.js';

// Mint a real Hono Context by driving one request through a capture handler.
async function mintContext(): Promise<Context> {
  const app = new Hono();
  let captured!: Context;
  app.get('*', (c) => {
    captured = c;
    return c.text('ok');
  });
  await app.request('http://localhost/');
  return captured;
}

// Resolves true if `p` is still pending after a few microtask ticks (long
// enough for the generator's synchronous backfill yields to settle).
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol();
  const ticks = Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => marker);
  const result = await Promise.race([p.then(() => false), ticks]);
  return result === marker;
}

beforeEach(() => resetDemoData());
afterEach(() => {
  __resetSimHeartbeatForTesting();
  vi.restoreAllMocks();
});

describe('activity live loader', () => {
  it('backfills recent events, streams a published event, and cleans up on abort', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const c = await mintContext();
    const ctrl = new AbortController();
    const r = await createCaller(c).call(serverLoaders.activity, {
      signal: ctrl.signal,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Drain the synchronous backfill until the stream parks on the channel.
    const backfill: unknown[] = [];
    let parked: Promise<IteratorResult<unknown>> | null = null;
    for (let i = 0; i < 12; i++) {
      const np = r.value.next();
      if (await isPending(np)) {
        parked = np;
        break;
      }
      const step = await np;
      expect(step.done).toBe(false);
      backfill.push(step.value);
    }
    expect(parked).not.toBeNull();
    expect(backfill.length).toBeGreaterThan(0);
    expect(backfill.length).toBeLessThanOrEqual(5);

    // A publish on the activity channel arrives as the next chunk. Give the
    // parked resumption a macrotask to register its subscription first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const task = getTask('t-1')!;
    publish(activityChannel.key(), taskMovedEvent(task, 'done', 'Alice'));
    const live = await parked!;
    expect(live.done).toBe(false);
    expect(live.value).toMatchObject({ kind: 'task-moved', taskId: 't-1' });

    // Abort ends the stream; the finally releases the sim heartbeat timer.
    const end = r.value.next();
    ctrl.abort();
    expect((await end).done).toBe(true);
    expect(clearSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: run the site suites and typecheck.** `pnpm vitest run apps/site/src` passes. Then `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck` passes.

- [ ] **Step 9: commit.**

```
git add apps/site/src/demo/activity-stream.ts apps/site/src/demo/activity-sim.ts apps/site/src/pages/demo/projects-shell.server.ts apps/site/src/pages/demo/task.server.ts apps/site/src/pages/demo/project-board.server.ts apps/site/src/demo/__tests__/activity-stream.test.ts apps/site/src/demo/__tests__/activity-sim.test.ts apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts
git commit -m "feat(site): move the demo activity feed onto a typed channel with eventStream

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: docs: eventStream in realtime.mdx and live-loaders.mdx

Two pages need syncing: `realtime.mdx` gets `eventStream` in its API reference, and `live-loaders.mdx`'s activity-bar example (which currently reproduces the hand-rolled queue/wake machine verbatim) is rewritten onto the channel + eventStream shape now used by the site.

**Files**

- Modify: `apps/site/src/pages/docs/realtime.mdx` (API reference, after the `### liveStream({ topic, load })` subsection, line 182)
- Modify: `apps/site/src/pages/docs/live-loaders.mdx` (the server-module example, lines 10-49, and the "On Cloudflare" section, line 129)

**Steps**

- [ ] **Step 1: realtime.mdx.** After the `### liveStream({ topic, load })` subsection (and before `### Type exports`), insert:

````mdx
### `eventStream(topic, signal)`

Subscribe to a topic as an async generator of its published payloads. Where `liveStream` re-runs a `load` snapshot on every publish (and discards the message), `eventStream` delivers each published payload itself, in order: the right shape for feeds and tickers where the event is the data.

```ts
import { defineChannel, defineLoader, eventStream } from 'hono-preact';

const activityChannel = defineChannel('activity')<ActivityEvent>();

export const serverLoaders = {
  activity: defineLoader(
    async function* ({ signal }) {
      for await (const e of eventStream(activityChannel.key(), signal)) {
        yield e;
      }
    },
    { live: true }
  ),
};
```

| Argument | Type             | Description                                                                            |
| -------- | ---------------- | -------------------------------------------------------------------------------------- |
| `topic`  | `Topic<Payload>` | The channel topic to subscribe to. Build it with `channel.key(...)`.                    |
| `signal` | `AbortSignal`    | Ends the stream and removes the subscription when aborted. Pass the loader's `signal`. |

Returns `AsyncGenerator<Serialize<Payload>, void, unknown>`. Payloads arrive in publish order and buffer while the consumer is busy. The yield type is the JSON wire shape (`Serialize<Payload>`): on Cloudflare a payload crosses isolates as JSON, so a `Date` arrives as its ISO string. If the underlying subscription drops, the generator throws, terminating the stream rather than going silently stale.
````

Also update the page's lead paragraph (line 3): after the sentence ending `pushes a fresh data snapshot on every publish.`, append the sentence: `When the event itself is the data, `eventStream(topic, signal)` yields each published payload directly to a streaming loader.`

- [ ] **Step 2: live-loaders.mdx.** Replace the server-module example (the fenced `ts` block under `**Server module** (`projects-shell.server.ts`):`, currently lines 11-49) with:

```ts
import { defineLoader, eventStream, type LoaderCtx } from 'hono-preact';
import {
  activityChannel,
  recentActivityEvents,
  type ActivityEvent,
} from './activity-stream.js';

// Backfill recent history, then stream every event published on the activity
// channel (server actions publish real events with
// `publish(activityChannel.key(), e)`).
async function* activityStream({
  signal,
}: LoaderCtx): AsyncGenerator<ActivityEvent, void, unknown> {
  for (const e of recentActivityEvents(5)) yield e;
  for await (const e of eventStream(activityChannel.key(), signal)) {
    yield e;
  }
}

export const serverLoaders = {
  default: defineLoader(shellLoader),
  activity: defineLoader(activityStream, { live: true }),
};
```

Then in the `## On Cloudflare` section, change the opening line (currently line 131) from

```
`publish()` and `route.loader(liveStream({ topic, load }))` have the same cross-isolate fan-out API on Cloudflare Workers.
```

to

```
`publish()`, `route.loader(liveStream({ topic, load }))`, and `eventStream(topic, signal)` share the same cross-isolate fan-out on Cloudflare Workers.
```

And at the end of that section's final paragraph (after `Read shared state in `load`, and `publish()` after you write it.`), append:

```
`eventStream` is the exception to the "event, not state" rule: it delivers the published payload itself (as its JSON wire shape), so a feed of self-contained events needs no shared read on the subscriber side.
```

- [ ] **Step 3: verify.** `pnpm vitest run apps/site/src/pages/docs/__tests__` passes.

- [ ] **Step 4: commit.**

```
git add apps/site/src/pages/docs/realtime.mdx apps/site/src/pages/docs/live-loaders.mdx
git commit -m "docs: document eventStream and rebase the live activity-bar example onto it

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: batch verification (CI parity)

Run the full pre-push sequence from the repo root of the worktree, in CI order. Every step must pass before the branch is handed back to the coordinator.

- [ ] **Step 1:** `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
- [ ] **Step 2:** `pnpm gen:agents-corpus`
- [ ] **Step 3:** `pnpm format:check` (if it fails, run `pnpm format` and commit the result as `chore: format` with the standard trailer)
- [ ] **Step 4:** `pnpm typecheck`
- [ ] **Step 5:** `pnpm test:types`
- [ ] **Step 6:** `pnpm test:coverage` (or `pnpm test`)
- [ ] **Step 7:** `pnpm test:integration`
- [ ] **Step 8:** `pnpm --filter site build`
- [ ] **Step 9:** `grep -rn "hoofd/preact" apps/site/src` returns nothing; `grep -rn "as unknown" apps/site/src/pages/demo/__tests__` returns nothing; `grep -rn "publishActivity" apps/site/src` returns nothing. Report results; do not push.

---

## Self-review notes (for the implementing agents)

- All line anchors were re-verified against `origin/main @ 97cf5282`. `subscribeTopic` moved to `packages/iso/src/internal/subscribe-topic.ts` since the issue was filed (the issue cited `server-route.ts:14`, which is now just the import site); the site tests moved under `apps/site/src/pages/demo/__tests__/`; the activity bus lives at `apps/site/src/demo/activity-stream.ts`.
- Type-consistency across tasks: `CallStreamOptions` (Tasks 4, 5, 8), `activityChannel: Channel<'demo-activity', ActivityEvent>` (Tasks 8, 9), `eventStream<P>(topic: Topic<P>, signal: AbortSignal): AsyncGenerator<Serialize<P>, void, unknown>` (Tasks 7, 8, 9), head hook names (Tasks 1, 2, 3).
- `Serialize<ActivityEvent>` equals `ActivityEvent` structurally (every field is a JSON primitive), so the site loader's `AsyncGenerator<ActivityEvent, ...>` annotation typechecks against `eventStream`'s yield type.
