# hono-preact

A small full-stack framework. Hono on the edge, Preact in the browser, manifest driven routes, typed RPC, streaming everywhere.

[**Docs**](https://framework.sbesh.com/docs) · [**Demo**](https://framework.sbesh.com/demo) · [**GitHub**](https://github.com/sbesh91/hono-preact)

## What it is

`hono-preact` is a single-package framework that pairs Hono (the runtime that handles requests on Cloudflare Workers) with Preact (the renderer in the browser). Routes are declared in code, not inferred from a folder tree, and loaders, actions, guards, and forms are typed end-to-end.

Four files. That's the whole project shape.

## Install

```bash
pnpm add hono-preact hono preact preact-iso preact-render-to-string hoofd
pnpm add -D vite
```

## Quick start

```ts
// vite.config.ts
import { defineApp } from 'hono-preact/vite';
export default defineApp();
```

```ts
// src/routes.ts
import { defineRoutes } from 'hono-preact';
export default defineRoutes([
  { path: '/', view: () => import('./views/home') },
]);
```

```tsx
// src/views/home.tsx
export default function Home() {
  return <h1>Hello</h1>;
}
```

```tsx
// src/Layout.tsx
import { ClientScript, Head } from 'hono-preact';
export default function Layout({ children }) {
  return (
    <html>
      <Head defaultTitle="hono-preact" />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
```

Full walkthrough: [Docs · Quick start](https://framework.sbesh.com/docs/quick-start).

## Status

`v0.6.0`. Pre-1.0; expect changes between minor versions.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
