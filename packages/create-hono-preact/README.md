# create-hono-preact

Scaffold a new hono-preact app.

```bash
npm create hono-preact my-app
pnpm create hono-preact my-app
yarn create hono-preact my-app
bun create hono-preact my-app
```

## Flags

- `--adapter=<cloudflare|node>` — pick the deployment target (default: `cloudflare`)
- `--no-install` — skip the package-manager install step
- `--no-git` — skip `git init`
- `--help`, `--version`

> Using npm, put framework flags after `--`: `npm create hono-preact my-app -- --adapter=node`. pnpm, yarn, and bun forward bare flags directly. (npm intercepts a bare `--adapter`; the scaffolder recovers it from `npm_config_*`, but npm still prints a warning.)

See [https://framework.sbesh.com/docs](https://framework.sbesh.com/docs) for the framework documentation.
