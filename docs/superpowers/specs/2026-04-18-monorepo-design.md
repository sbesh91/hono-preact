# Monorepo Design

**Date:** 2026-04-18
**Status:** Approved

## Overview

Convert the current single-package repo into a pnpm monorepo that separates the Hono + Preact framework code into publishable npm packages. The app (docs site) moves to `apps/app` and continues to work on Cloudflare Workers. npm publishing is out of scope for this spec.

## Repo Structure

```
hono-preact/
├── pnpm-workspace.yaml
├── package.json                ← root (private, scripts only)
├── tsconfig.json               ← shared base tsconfig (extended by packages); contains common compilerOptions like moduleResolution, target, jsx settings
├── apps/
│   └── app/                   ← all current root content moves here
│       ├── package.json
│       ├── wrangler.jsonc
│       ├── vite.config.ts
│       ├── vite-plugin-server-only.ts
│       ├── tsconfig.json
│       ├── postcss.config.mjs
│       ├── src/
│       └── docs/
└── packages/
    ├── iso/                   ← @hono-preact/iso
    ├── server/                ← @hono-preact/server
    ├── vite/                  ← @hono-preact/vite
    └── hono-preact/           ← umbrella package
```

## Phase 1: pnpm Migration + App Move

Goal: get the monorepo structure in place with CI green. No import paths change.

### Steps

1. Add `pnpm-workspace.yaml` at root:
   ```yaml
   packages:
     - 'apps/*'
     - 'packages/*'
   ```

2. Create root `package.json` — private, no dependencies, scripts delegate to the app:
   ```json
   {
     "name": "hono-preact-monorepo",
     "private": true,
     "scripts": {
       "dev": "pnpm --filter app dev",
       "build": "pnpm --filter app build",
       "deploy": "pnpm --filter app deploy"
     }
   }
   ```

3. Move all current root files into `apps/app/`:
   - `src/`, `docs/`, `dist/`
   - `vite.config.ts`, `vite-plugin-server-only.ts`
   - `wrangler.jsonc`, `tsconfig.json`, `postcss.config.mjs`, `dockerfile`
   - `package.json` (becomes `apps/app/package.json`, rename `"name"` to `"app"`)

4. Delete `package-lock.json`. Run `pnpm install` from root to generate `pnpm-lock.yaml`.

5. Update Cloudflare CI build command from `npm run build` to `pnpm --filter app build`.

6. Verify locally: `pnpm dev`, `pnpm build` work from root.

### Success Criteria
- `pnpm dev` serves the app
- `pnpm build` produces `apps/app/dist/`
- Cloudflare CI build passes

## Phase 2: Package Extraction

Extract framework code into `packages/*` one package at a time. After each extraction, update `apps/app` to consume the new package before starting the next.

### Package Definitions

#### `@hono-preact/vite`
- **Source:** `apps/app/vite-plugin-server-only.ts`
- **Exports:** `serverLoaderValidationPlugin`
- **Peer deps:** `vite`
- **Build:** `tsc` (single file, no bundling needed)

#### `@hono-preact/iso`
- **Source:** `apps/app/src/iso/*`
- **Exports:** `getLoaderData`, `useReload`, `GuardFn`, `GuardRedirect`, `runGuards`, `LoaderCache`, `isBrowser`, and other public primitives
- **Peer deps:** `preact`, `preact-iso`
- **Build:** Vite library mode with `preserveModules` (keep individual files for tree-shaking)

#### `@hono-preact/server`
- **Source:** `apps/app/src/server/*`
- **Exports:** server context, middleware, layout utilities
- **Peer deps:** `hono`, `preact`, `preact-render-to-string`
- **Depends on:** `@hono-preact/iso` (workspace:*)
- **Build:** Vite library mode with `preserveModules`

#### `hono-preact` (umbrella)
- **Source:** thin re-export file
- **Exports:** re-exports everything from `@hono-preact/iso`, `@hono-preact/server`, `@hono-preact/vite`
- **Depends on:** all three packages above (workspace:*)
- **Build:** `tsc`

### Per-Package Structure

Each package follows this layout:
```
packages/<name>/
├── package.json
├── tsconfig.json       ← extends ../../tsconfig.json
├── src/
│   └── index.ts        ← public API barrel
└── dist/               ← build output (gitignored)
```

Each `package.json` includes:
```json
{
  "name": "@hono-preact/<name>",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "...",
    "dev": "... --watch"
  }
}
```

### Extraction Order

Extract in this order to minimize cross-package dependency complexity:

1. **`@hono-preact/vite`** — no framework deps, isolated plugin file
2. **`@hono-preact/iso`** — core runtime, no dependency on server package
3. **`@hono-preact/server`** — depends on iso types
4. **`hono-preact`** — umbrella, depends on all three

### App Update Per Extraction

After extracting each package:
1. Add `"@hono-preact/<name>": "workspace:*"` to `apps/app/package.json`
2. Delete the extracted source files from `apps/app`
3. Update import paths in `apps/app/src` to use the package name
4. Run `pnpm install` and verify `pnpm dev` still works

### Success Criteria
- All four packages build without errors
- `apps/app` has no remaining copies of extracted source
- `pnpm dev` and `pnpm build` work end-to-end
- Cloudflare CI build passes
