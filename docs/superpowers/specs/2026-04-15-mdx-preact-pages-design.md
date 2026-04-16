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
  export const route: string | undefined;
  const MDXContent: ComponentType;
  export default MDXContent;
}
```

Update `tsconfig.json` `include` to add `"./src/**/*.mdx"` so the compiler resolves `.mdx` files.

## Authoring Convention

MDX pages live in `src/pages/docs/` and export a `route` const that declares the path **relative to `/docs`**:

```mdx
export const route = '/about'

# About

Page content here.
```

The registration code (see below) automatically prepends `/docs`, so the above page is served at `/docs/about`. Authors never write the `/docs` prefix — it is implied by the directory. This prevents a whole class of mistakes where someone forgets the prefix or miskeys it.

The export is named `route` (not `path`) deliberately: preact-iso augments `JSX.IntrinsicAttributes` with a reserved `path` prop used internally by the router. Using `path` as a module export would collide with that name.

Pages without a `route` export are valid MDX components but will not be registered as routes.

## Route Auto-Discovery

`iso.tsx` uses `import.meta.glob` with `eager: true` to collect all MDX pages at build time. The `/docs` prefix is prepended to each `route` export before passing it to `<Route>`:

```tsx
const mdxPages = import.meta.glob('./pages/docs/*.mdx', { eager: true }) as Record<
  string,
  { default: ComponentType; route?: string }
>;

// Inside <Router>:
{Object.values(mdxPages)
  .filter((mod) => mod.route)
  .map((mod) => (
    <Route path={`/docs${mod.route}`} component={mod.default} />
  ))}
```

MDX routes are rendered alongside the existing hand-authored routes. No changes to `server.tsx` are required — the server already SSR-renders the full app via `prerender`.

## Out of Scope

- Server-side data loading for MDX pages (`serverLoader`)
- Frontmatter processing
- Nested MDX directories
- MDX component overrides via `MDXProvider`
