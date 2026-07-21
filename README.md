# hono-preact

A small full-stack framework. Hono on the edge, Preact in the browser, manifest driven routes, typed RPC, streaming everywhere.

[**Docs**](https://framework.sbesh.com/docs) · [**Demo**](https://framework.sbesh.com/demo) · [**GitHub**](https://github.com/sbesh91/hono-preact)

[![Lighthouse Performance](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/sbesh91/hono-preact/metrics/lighthouse-badge.json)](https://framework.sbesh.com)

## What it is

`hono-preact` is a single-package framework that pairs Hono (the runtime that handles requests on Cloudflare Workers) with Preact (the renderer in the browser). Routes are declared in code, not inferred from a folder tree, and loaders, actions, guards, and forms are typed end-to-end.

Four files. That's the whole project shape.

## Quick start

The fastest way to start is the scaffolder. Run it with no arguments for the
interactive wizard, or pass a directory:

```bash
npm create hono-preact
# or: pnpm create hono-preact my-app
```

The wizard picks the adapter (Cloudflare Workers or Node), optional
`hono-preact-ui` components, and whether to install and init git. For scripting,
every prompt has a flag (`--adapter`, `--ui`/`--no-ui`, `--no-install`,
`--no-git`, `--yes`); with npm, pass tool flags after `--`
(`npm create hono-preact my-app -- --adapter node`). pnpm, yarn, and bun forward
them directly.

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
  { path: '/', view: () => import('./pages/home.js') },
]);
```

```tsx
// src/pages/home.tsx
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
pnpm add hono-preact hono preact 'preact-iso@github:preactjs/preact-iso#22460942e6e0ff9b9d4a8a9cf16222ad59797777' preact-render-to-string hoofd
pnpm add -D vite
```

> `preact-iso` comes from GitHub, pinned to an immutable v3 commit (`github:preactjs/preact-iso#22460942e6e0ff9b9d4a8a9cf16222ad59797777`); the npm release is still 2.x and lacks the `RouteHook` shape (`pathParams`/`searchParams`) the framework relies on. The scaffolder pins this for you.

## Status

`v0.12.0`. Pre-1.0; expect changes between minor versions.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
