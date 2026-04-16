# MDX Preact Pages

**Date:** 2026-04-15
**Status:** Approved

## Overview

Add MDX file support so that static content pages can be authored in `.mdx` and automatically discovered as preact-iso routes. No server-side data loading is in scope for this iteration.

## Packages

Add one devDependency: `@mdx-js/rollup`. No `@mdx-js/preact` is needed — the project already configures `jsxImportSource: 'preact'` in `tsconfig.json`, which covers the JSX runtime for compiled MDX output.

## Vite Configuration

Add the MDX Rollup plugin to both build configs in `vite.config.ts`.

```ts
import mdx from '@mdx-js/rollup';
```

The MDX plugin must run before JSX is processed. Use `Object.assign` to attach the Vite `enforce: 'pre'` flag without mutating the plugin object:

```ts
Object.assign(mdx({ jsxImportSource: 'preact' }), { enforce: 'pre' })
```

`jsxImportSource: 'preact'` is required here even though `tsconfig.json` already sets it globally. The MDX compiler transforms `.mdx` files to JavaScript independently of the TypeScript compiler — without this option, MDX defaults to the React JSX runtime. The tsconfig setting only applies to `.ts`/`.tsx` files processed by TypeScript.

**Client config** — add before `preact()`, since both plugins transform JSX and ordering matters:
```ts
plugins: [
  Object.assign(mdx({ jsxImportSource: 'preact' }), { enforce: 'pre' }),
  preact(),
  ...
]
```

**Server config** — `preact()` is not present; add first in the array:
```ts
plugins: [
  Object.assign(mdx({ jsxImportSource: 'preact' }), { enforce: 'pre' }),
  serverLoaderValidationPlugin(),
  build(...),
  devServer(...),
]
```

No remark/rehype plugins are added; the default MDX pipeline is used.

## TypeScript

Add `src/mdx.d.ts` to declare the shape of `.mdx` module imports:

```ts
declare module '*.mdx' {
  import type { ComponentType } from 'preact';
  const MDXContent: ComponentType;
  export default MDXContent;
}
```

Update `tsconfig.json` `include` to add `"./src/**/*.mdx"` so the compiler resolves `.mdx` files.

## Authoring Convention

MDX pages live in `src/pages/docs/`. The route path is derived from the filename — `hello.mdx` is served at `/docs/hello`. No `route` export is needed; the directory location is the only convention.

```mdx
# Hello

Page content here.
```

The `/docs` prefix is implicit — it is always prepended by the registration code. Authors only control the sub-path via their filename choice.

## Route Auto-Discovery

`iso.tsx` uses `import.meta.glob` **without** `eager: true` to keep MDX files out of the main bundle. Each loader is wrapped with `lazy()`, consistent with how `Home`, `Test`, and `Movies` are handled. The route path is derived from the glob key (the file path string), not from anything inside the module:

```tsx
const mdxModules = import.meta.glob('./pages/docs/*.mdx');

const mdxRoutes = Object.entries(mdxModules).map(([filePath, load]) => {
  // './pages/docs/hello.mdx' -> '/docs/hello'
  const route = '/docs' + filePath.replace('./pages/docs', '').replace('.mdx', '');
  const Component = lazy(load as () => Promise<{ default: ComponentType }>);
  return { route, Component };
});

// Inside <Router>:
{mdxRoutes.map(({ route, Component }) => (
  <Route path={route} component={Component} />
))}
```

MDX routes are rendered alongside the existing hand-authored routes. No changes to `server.tsx` are required — the server already SSR-renders the full app via `prerender`.

## Out of Scope

- Server-side data loading for MDX pages (`serverLoader`)
- Frontmatter processing
- Nested MDX directories
- MDX component overrides via `MDXProvider`
