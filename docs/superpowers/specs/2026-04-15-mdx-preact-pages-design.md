# MDX Preact Pages

**Date:** 2026-04-15
**Status:** Approved

## Overview

Add MDX file support so that static content pages can be authored in `.mdx` and automatically discovered as preact-iso routes. No server-side data loading is in scope for this iteration.

## Packages

Add one devDependency: `@mdx-js/rollup`. No `@mdx-js/preact` is needed — the project already configures `jsxImportSource: 'preact'` in `tsconfig.json`, which covers the JSX runtime for compiled MDX output.

## Vite Configuration

Add the MDX Rollup plugin to both build configs in `vite.config.ts` (client/visualizer and server). It must be placed **before** `preact()` in the plugins array, since both plugins transform JSX and ordering matters.

```ts
import mdx from '@mdx-js/rollup';

// In plugins (both configs):
{ enforce: 'pre', ...mdx({ jsxImportSource: 'preact' }) },
preact(),
```

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

MDX pages live in `src/pages/` and export a `route` const that declares the URL path:

```mdx
export const route = '/about'

# About

Page content here.
```

Pages without a `route` export are valid MDX components but will not be registered as routes.

## Route Auto-Discovery

`iso.tsx` uses `import.meta.glob` with `eager: true` to collect all MDX pages at build time and renders a `<Route>` for each module that has a `route` export:

```tsx
const mdxPages = import.meta.glob('./pages/*.mdx', { eager: true }) as Record<
  string,
  { default: ComponentType; route?: string }
>;

// Inside <Router>:
{Object.values(mdxPages)
  .filter((mod) => mod.route)
  .map((mod) => (
    <Route key={mod.route} path={mod.route!} component={mod.default} />
  ))}
```

MDX routes are rendered alongside the existing hand-authored routes. No changes to `server.tsx` are required — the server already SSR-renders the full app via `prerender`.

## Out of Scope

- Server-side data loading for MDX pages (`serverLoader`)
- Frontmatter processing
- Nested MDX directories
- MDX component overrides via `MDXProvider`
