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
cd dist/{{name}}     # NOTE: if your project name has hyphens, the dir name has underscores (e.g. "my-app" -> "my_app")
wrangler deploy
```

## Learn more

- [Quick Start](https://framework.sbesh.com/docs/quick-start)
- [Composing Hono Middleware](https://framework.sbesh.com/docs/hono-middleware)
- [Build & Deploy](https://framework.sbesh.com/docs/deployment)
