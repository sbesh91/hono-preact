# hono-preact

A small full-stack framework. Hono on the edge, Preact in the browser, manifest driven routes, typed RPC, streaming everywhere.

[**Docs**](https://framework.sbesh.com/docs) · [**Demo**](https://framework.sbesh.com/demo) · [**GitHub**](https://github.com/sbesh91/hono-preact)

[![Lighthouse Performance](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/sbesh91/hono-preact/metrics/lighthouse-badge.json)](https://framework.sbesh.com)

## What it is

`hono-preact` is a single-package framework that pairs Hono (the runtime that handles requests on Cloudflare Workers) with Preact (the renderer in the browser). Routes are declared in code, not inferred from a folder tree, and loaders, actions, guards, and forms are typed end-to-end.

Four files. That's the whole project shape.

## Quick start

The fastest way to start is the scaffolder. It generates a complete, deploy-ready app and installs dependencies for you:

```bash
npm create hono-preact my-app
# or: pnpm create hono-preact my-app
# or: yarn create hono-preact my-app
# or: bun create hono-preact my-app
```

Then:

```bash
cd my-app
pnpm dev
```

Options:

- `--adapter=<cloudflare|node>` pick the deployment target (default: `cloudflare`)
- `--no-install` skip the dependency install step
- `--no-git` skip `git init`
- `--help`, `--version`

Full CLI reference: [Docs · CLI](https://framework.sbesh.com/docs/cli).

## What a project looks like

These are the four files the scaffolder writes:

```ts
// vite.config.ts
import { honoPreact } from 'hono-preact/vite';
import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [honoPreact({ adapter: cloudflareAdapter() })],
});
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

## Manual install

Adding hono-preact to an existing project instead of scaffolding a new one:

```bash
pnpm add hono-preact hono preact preact-iso preact-render-to-string hoofd
pnpm add -D vite
```

## Status

`v0.6.0`. Pre-1.0; expect changes between minor versions.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
