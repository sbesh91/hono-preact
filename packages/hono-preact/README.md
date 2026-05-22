# hono-preact

A small full-stack framework. Hono on the edge, Preact in the browser, manifest driven routes, typed RPC, streaming everywhere.

- **Docs:** https://framework.sbesh.com/docs
- **Demo:** https://framework.sbesh.com/demo
- **Repo:** https://github.com/sbesh91/hono-preact

## Install

```bash
pnpm add hono-preact hono preact preact-iso preact-render-to-string hoofd
pnpm add -D vite
```

## Quick start

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { honoPreact } from 'hono-preact/vite';

export default defineConfig({
  plugins: [honoPreact()],
});
```

```ts
// src/routes.ts
import { defineRoutes } from 'hono-preact';
export default defineRoutes([
  { path: '/', view: () => import('./pages/home.js') },
]);
```

Full walkthrough: https://framework.sbesh.com/docs/quick-start

## Subpaths

- `hono-preact`: iso runtime exports (routes, pages, loaders, actions, forms, middleware, outcomes).
- `hono-preact/page`: page-scope outcome kitchen sink (`redirect`, `deny`, `render`, predicates).
- `hono-preact/server`: server entry, `renderPage`, SSR streaming helpers.
- `hono-preact/vite`: `honoPreact()` plugin for Vite.
- `hono-preact/internal`: advanced exports for tooling authors. No stability guarantee.

## License

MIT
