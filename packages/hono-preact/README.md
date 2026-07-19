# hono-preact

A small full-stack framework. Hono on the edge, Preact in the browser, manifest driven routes, typed RPC, streaming everywhere.

- **Docs:** https://framework.sbesh.com/docs
- **Demo:** https://framework.sbesh.com/demo
- **Repo:** https://github.com/sbesh91/hono-preact

## Install

```bash
pnpm add hono-preact hono preact 'preact-iso@github:preactjs/preact-iso#22460942e6e0ff9b9d4a8a9cf16222ad59797777' preact-render-to-string hoofd
pnpm add -D vite
```

> `preact-iso` comes from GitHub, pinned to an immutable v3 commit (`github:preactjs/preact-iso#22460942e6e0ff9b9d4a8a9cf16222ad59797777`); the npm release is still 2.x. The scaffolder pins this for you.

## Quick start

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { honoPreact } from 'hono-preact/vite';
import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';

export default defineConfig({
  plugins: [honoPreact({ adapter: cloudflareAdapter() })],
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
- `hono-preact/server`: the public server barrel: `renderPage`, `HonoContext`, `useHonoContext`.
- `hono-preact/vite`: `honoPreact()` plugin for Vite.
- `hono-preact/internal`: advanced exports for tooling authors. No stability guarantee.

## License

MIT
