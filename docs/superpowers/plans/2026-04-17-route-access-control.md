# Route Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Hono-middleware-inspired guard system that protects SSR page routes on both server (initial load) and client (client-side navigation).

**Architecture:** Guards are chainable async functions that receive `GuardContext` and a `next()` callback, mirroring Hono's middleware pattern. They run as a `wrapPromise` step before the loader in `page.tsx`. `serverGuards` live in `.server.ts` files and are tree-shaken from the client bundle by the existing Vite plugin; `clientGuards` live inline.

**Tech Stack:** Preact, preact-iso, Hono, Vite (custom plugins), TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/iso/guard.ts` | Create | `GuardFn`, `GuardResult`, `GuardContext`, `GuardRedirect`, `createGuard`, `runGuards` |
| `src/iso/loader.tsx` | Modify | Add `serverGuards`/`clientGuards` to `LoaderProps` and `getLoaderData` signature |
| `src/iso/page.tsx` | Modify | Execute guard chain before loader; handle redirect/render results |
| `src/server.tsx` | Modify | Catch `GuardRedirect` thrown during SSR and return HTTP redirect |
| `vite-plugin-server-only.ts` | Modify | Allow `serverGuards` named export in `.server.ts`; stub it in client builds |

---

## Task 1: Create `src/iso/guard.ts`

**Files:**
- Create: `src/iso/guard.ts`

- [ ] **Step 1: Create the file**

```ts
// src/iso/guard.ts
import { type FunctionComponent } from 'preact';
import { type RouteHook } from 'preact-iso';

export type GuardResult =
  | { redirect: string }
  | { render: FunctionComponent }
  | void;

export type GuardContext = {
  location: RouteHook;
};

export type GuardFn = (
  ctx: GuardContext,
  next: () => Promise<GuardResult>
) => Promise<GuardResult>;

export const createGuard = (fn: GuardFn): GuardFn => fn;

export const runGuards = async (
  guards: GuardFn[],
  ctx: GuardContext
): Promise<GuardResult> => {
  const run = async (index: number): Promise<GuardResult> => {
    if (index >= guards.length) return;
    return guards[index](ctx, () => run(index + 1));
  };
  return run(0);
};

export class GuardRedirect {
  constructor(public readonly location: string) {}
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact
npx tsc --noEmit
```

Expected: no errors related to `guard.ts`. Other pre-existing errors are acceptable.

- [ ] **Step 3: Commit**

```bash
git add src/iso/guard.ts
git commit -m "feat: add guard types, createGuard, runGuards, and GuardRedirect"
```

---

## Task 2: Extend `LoaderProps` in `loader.tsx`

**Files:**
- Modify: `src/iso/loader.tsx`

- [ ] **Step 1: Add `GuardFn` import and extend `LoaderProps`**

In `src/iso/loader.tsx`, add the import and two new optional fields to `LoaderProps`:

```ts
// Add to imports at top of file:
import { type GuardFn } from './guard.js';
```

Replace the `LoaderProps` interface:

```ts
interface LoaderProps<T> {
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
}
```

- [ ] **Step 2: Thread `serverGuards` and `clientGuards` through `getLoaderData`**

`getLoaderData` destructures `LoaderProps` and passes to `Page`. Update the destructure and JSX:

```ts
export const getLoaderData = <T extends {}>(
  Component: FunctionComponent<LoaderData<T>>,
  { serverLoader, clientLoader, cache, serverGuards, clientGuards }: LoaderProps<T> = {}
) => {
  return memo((location: RouteHook) => {
    return (
      <Page
        Child={Component}
        serverLoader={serverLoader}
        clientLoader={clientLoader}
        location={location}
        cache={cache}
        serverGuards={serverGuards}
        clientGuards={clientGuards}
      />
    );
  });
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors about `Page` not accepting `serverGuards`/`clientGuards` props yet — that's correct, Task 3 will fix them.

- [ ] **Step 4: Commit**

```bash
git add src/iso/loader.tsx
git commit -m "feat: add serverGuards and clientGuards to LoaderProps"
```

---

## Task 3: Add guard execution to `page.tsx`

**Files:**
- Modify: `src/iso/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/iso/page.tsx`, add:

```ts
import { useLocation } from 'preact-iso';
import { type GuardFn, GuardRedirect, runGuards } from './guard.js';
```

- [ ] **Step 2: Extend `PageProps` to include guard arrays**

Replace the existing `PageProps` type:

```ts
type PageProps<T> = {
  Child: FunctionComponent<LoaderData<T>>;
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  location: RouteHook;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
};
```

- [ ] **Step 3: Update the `Page` component**

Replace the full `Page` component with the version below. Guards run as a separate `wrapPromise` step before the loader. `useLocation` provides the `route()` function for client-side redirects.

```ts
export const Page = memo(function <T extends {}>({
  Child,
  serverLoader = async () => ({}) as T,
  clientLoader = serverLoader,
  location,
  cache,
  serverGuards = [],
  clientGuards = [],
}: PageProps<T>) {
  const id = useId();
  const { route } = useLocation();

  const guards = isBrowser() ? clientGuards : serverGuards;

  const guardRef = useRef(
    wrapPromise(runGuards(guards, { location }))
  );

  const guardResult = guardRef.current.read();

  if (guardResult?.redirect) {
    if (isBrowser()) {
      route(guardResult.redirect);
      return null;
    } else {
      throw new GuardRedirect(guardResult.redirect);
    }
  }

  if (guardResult?.render) {
    const Fallback = guardResult.render;
    return <Fallback />;
  }

  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;

  if (isLoaded) {
    cache?.set(location.path, preloaded);
    return <Helper id={id} Child={Child} loader={{ read: () => preloaded }} />;
  }

  if (isBrowser() && cache?.has(location.path)) {
    const cached = cache.get(location.path)!;
    return <Helper id={id} Child={Child} loader={{ read: () => cached }} />;
  }

  const loaderRef = useRef(
    wrapPromise(
      isBrowser()
        ? clientLoader({ location }).then((r) => {
            cache?.set(location.path, r);
            return r;
          })
        : serverLoader({ location })
    )
  );

  return (
    <Suspense fallback={null}>
      <Helper id={id} Child={Child} loader={loaderRef.current} />
    </Suspense>
  );
});
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors. The `Page` prop errors from Task 2 should now be resolved.

- [ ] **Step 5: Commit**

```bash
git add src/iso/page.tsx
git commit -m "feat: run guard chain in Page before loader, handle redirect and render results"
```

---

## Task 4: Catch `GuardRedirect` in `server.tsx`

**Files:**
- Modify: `src/server.tsx`

- [ ] **Step 1: Add `GuardRedirect` import**

At the top of `src/server.tsx`, add:

```ts
import { GuardRedirect } from './iso/guard.js';
```

- [ ] **Step 2: Wrap the SSR prerender call in a try/catch**

Replace the existing `get('*', ...)` handler body:

```ts
.get('*', async (c) => {
  const dispatcher = createDispatcher();

  let html: string;
  try {
    ({ html } = await prerender(
      <HoofdProvider value={dispatcher}>
        <Layout context={c} />
      </HoofdProvider>
    ));
  } catch (e) {
    if (e instanceof GuardRedirect) return c.redirect(e.location);
    throw e;
  }

  const { title, lang, metas = [], links = [] } = dispatcher.toStatic();

  const toAttrs = (obj: Record<string, string | undefined>) =>
    Object.entries(obj)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
      .join(' ');

  const headTags = [
    `<title>${title ?? 'hono-preact'}</title>`,
    ...metas.map((m) => `<meta ${toAttrs(m as Record<string, string>)} />`),
    ...links.map((l) => `<link ${toAttrs(l as Record<string, string>)} />`),
  ].join('\n        ');

  // c.header('Cache-Control', 'no-store');
  return c.html(
    `<!doctype html>
    <html lang="${lang ?? 'en-US'}">
      ${html.replace('</head>', `${headTags}\n      </head>`)}
    </html>`
  );
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server.tsx
git commit -m "feat: catch GuardRedirect during SSR and return HTTP redirect"
```

---

## Task 5: Update Vite plugin for `serverGuards` convention

**Files:**
- Modify: `vite-plugin-server-only.ts`

- [ ] **Step 1: Allow `serverGuards` as a named export in `serverLoaderValidationPlugin`**

In `serverLoaderValidationPlugin`, the validation currently errors on any named export. Update the check to allow `serverGuards` specifically:

Replace:
```ts
if (namedExports.length > 0) {
  this.error(
    `${id}: .server files must not have named exports (found: ${namedExports.join(', ')}). ` +
      `Export the server loader as the default export only.`
  );
}
```

With:
```ts
const disallowedExports = namedExports.filter((n) => n !== 'serverGuards');
if (disallowedExports.length > 0) {
  this.error(
    `${id}: .server files may only export 'serverGuards' as a named export (found: ${disallowedExports.join(', ')}). ` +
      `Export the server loader as the default export only.`
  );
}
```

- [ ] **Step 2: Stub `serverGuards` named imports in `serverOnlyPlugin`**

`serverOnlyPlugin` currently only detects and stubs the default import. Update it to also handle a `serverGuards` named import.

Replace the entire `transform` function body in `serverOnlyPlugin` with:

```ts
transform(code: string, id: string) {
  if (/\.server\.[jt]sx?$/.test(id)) return;
  if (!code.includes('.server')) return;

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: true,
  });

  const isServerImport = (node: unknown): node is ImportDeclaration =>
    (node as ImportDeclaration).type === 'ImportDeclaration' &&
    /\.server(\.[jt]sx?)?$/.test(
      (node as ImportDeclaration).source.value
    ) &&
    (node as ImportDeclaration).specifiers.some(
      (s) =>
        s.type === 'ImportDefaultSpecifier' ||
        (s.type === 'ImportSpecifier' &&
          s.imported.type === 'Identifier' &&
          s.imported.name === 'serverGuards')
    );

  const serverImport = ast.program.body.find(isServerImport);
  if (!serverImport) return;

  const stubs: string[] = [];

  for (const s of serverImport.specifiers) {
    if (s.type === 'ImportDefaultSpecifier') {
      stubs.push(`const ${s.local.name} = async () => ({});`);
    } else if (
      s.type === 'ImportSpecifier' &&
      s.imported.type === 'Identifier' &&
      s.imported.name === 'serverGuards'
    ) {
      stubs.push(`const ${s.local.name} = [];`);
    }
  }

  if (stubs.length === 0) return;

  const s = new MagicString(code);
  s.overwrite(serverImport.start!, serverImport.end!, stubs.join('\n'));
  return { code: s.toString(), map: s.generateMap({ hires: true }) };
},
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add vite-plugin-server-only.ts
git commit -m "feat: allow serverGuards named export in .server files, stub in client build"
```

---

## Task 6: Smoke test with a demo guard

**Files:**
- Modify: `src/pages/movies.server.ts` (temporarily)
- Modify: `src/pages/movies.tsx` (temporarily)

This task manually verifies the full guard pipeline works end-to-end. Revert the changes after confirming.

- [ ] **Step 1: Add a demo `serverGuards` export to `movies.server.ts`**

Open `src/pages/movies.server.ts` and add below the existing `serverLoader` default export:

```ts
import { createGuard } from '../iso/guard.js';

export const serverGuards = [
  createGuard(async (_ctx, _next) => {
    // Always redirect — proves the guard fires on server
    return { redirect: '/test' };
  }),
];
```

- [ ] **Step 2: Add `clientGuards` and `serverGuards` to `movies.tsx`**

In `src/pages/movies.tsx`, update the import and `getLoaderData` call:

```ts
import serverLoader, { serverGuards } from './movies.server.js';

const clientGuards = [
  createGuard(async (_ctx, _next) => {
    return { redirect: '/test' };
  }),
];

export default getLoaderData(Movies, {
  serverLoader,
  clientLoader,
  cache,
  serverGuards,
  clientGuards,
});
```

Also add the `createGuard` import at the top:
```ts
import { createGuard } from '../iso/guard.js';
```

- [ ] **Step 3: Start the dev server and verify**

```bash
npm run dev
```

Navigate to `http://localhost:5173/movies` in a browser.

Expected:
- Direct navigation (SSR): browser lands on `/test` (server guard fired, `GuardRedirect` caught by Hono handler)
- Client-side navigation (click a link to `/movies`): browser navigates to `/test` (client guard fired, `useLocation().route()` called)

- [ ] **Step 4: Revert demo guard changes**

```bash
git checkout src/pages/movies.server.ts src/pages/movies.tsx
```

- [ ] **Step 5: Verify build succeeds**

```bash
npm run build
```

Expected: build completes without errors.

- [ ] **Step 6: Commit build verification**

```bash
git commit --allow-empty -m "chore: verify route access control guard system builds and works end-to-end"
```
