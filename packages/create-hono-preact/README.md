# create-hono-preact

Scaffold a new hono-preact app. Run with no arguments for the interactive
wizard, or pass a directory.

```bash
npm create hono-preact
pnpm create hono-preact my-app
```

## Flags (scripted/CI)

- `--adapter <cloudflare|node>` pick the deployment target (prompted otherwise)
- `--ui`, `--no-ui` include or exclude hono-preact-ui components
- `--no-install` skip the package-manager install step
- `--no-git` skip `git init`
- `-y`, `--yes` accept defaults for anything not specified
- `--skip-hints` suppress the "Next steps" note
- `--help`, `--version`

> With npm, put tool flags after `--`: `npm create hono-preact my-app -- --adapter node`.
> pnpm, yarn, and bun forward bare flags directly.

See [https://framework.sbesh.com/docs](https://framework.sbesh.com/docs) for the framework documentation.
