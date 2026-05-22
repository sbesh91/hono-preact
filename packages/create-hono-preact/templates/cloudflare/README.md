# {{name}}

A [hono-preact](https://framework.sbesh.com) app, scaffolded for Cloudflare Workers.

## Develop

```bash
pnpm dev
```

The Cloudflare adapter runs your worker inside workerd via `@cloudflare/vite-plugin`, so development mirrors production.

## Build

```bash
pnpm build
```

Outputs:

- `dist/client/` static assets, served from Cloudflare's CDN
- `dist/<name>/` the Worker bundle (hyphens in `wrangler.jsonc`'s `name` become underscores)

## Deploy

```bash
pnpm build
pnpm deploy
```

The framework writes the Worker bundle to `dist/{{name_underscore}}/` (hyphens in your project name become underscores in the bundle dir). The `deploy` script reads the bundle's generated `wrangler.json` from there.

## Learn more

- [Quick Start](https://framework.sbesh.com/docs/quick-start)
- [Composing Hono Middleware](https://framework.sbesh.com/docs/hono-middleware)
- [Build & Deploy](https://framework.sbesh.com/docs/deployment)
