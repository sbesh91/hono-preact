# One Package, Three Subpaths

**Date:** 2026-05-14
**Status:** Draft
**Scope:** v0.1 sequencing item 7. Collapse the user-visible surface to a single `hono-preact` package with four subpaths. Hard cutover.

## TL;DR

Users install **one** package: `hono-preact`. The umbrella declares the three internal packages (`@hono-preact/iso`, `@hono-preact/server`, `@hono-preact/vite`) as ordinary npm dependencies, and re-exports them through four subpath entries.

Public surface after this change:

```ts
import { definePage, defineLoader, useAction, Form } from 'hono-preact';
import { renderPage, HonoContext } from 'hono-preact/server';
import { honoPreact } from 'hono-preact/vite';
import { Loader, Envelope, ... } from 'hono-preact/internal';   // escape hatch
```

The string `@hono-preact/*` disappears from demo code, docs, and user-typed imports. It still appears in:
- The user's lockfile (as transitive deps of `hono-preact`).
- Plugin-emitted bundle code (`import { ... } from '@hono-preact/iso/internal'`) — the internal packages are real published packages on npm, so these imports resolve normally.

**No bundler.** All four packages build with `tsc`. `pnpm publish` rewrites `workspace:*` to a pinned version range at publish time.

## Why

Per spec section 8: "The published surface is one package, three subpaths. The user never types `@hono-preact/*`." The spec's literal "workspace packages stay as build-time concerns" wording is intentionally interpreted as user-visible surface, not as "must not appear on npm." Publishing the workspace packages alongside the umbrella honors the user-facing goal (one import root) without adding a bundler to the framework's surface area.

## Package layout

```
packages/
  iso/          # @hono-preact/iso, public on npm, tsc build
  server/       # @hono-preact/server, public on npm, tsc build
  vite/         # @hono-preact/vite, public on npm, tsc build
  hono-preact/  # PUBLISHED, tsc build, re-export shim
    src/
      index.ts      # export * from '@hono-preact/iso';
      server.ts     # export * from '@hono-preact/server';     (new)
      vite.ts       # export * from '@hono-preact/vite';       (exists)
      internal.ts   # export * from '@hono-preact/iso/internal'; (new)
    package.json
```

All four `package.json`s drop the `"private": true` field. `packages/hono-preact/package.json` has `"private": true` today (since the package was an unpublished umbrella); the three workspace packages do as well (`packages/iso/package.json`, etc.). Source organization stays exactly as it is today.

## `package.json` shapes

**Umbrella (`packages/hono-preact/package.json`):**

```json
{
  "name": "hono-preact",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".":          { "types": "./dist/index.d.ts",    "import": "./dist/index.js" },
    "./server":   { "types": "./dist/server.d.ts",   "import": "./dist/server.js" },
    "./vite":     { "types": "./dist/vite.d.ts",     "import": "./dist/vite.js" },
    "./internal": { "types": "./dist/internal.d.ts", "import": "./dist/internal.js" }
  },
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@hono-preact/iso":    "workspace:*",
    "@hono-preact/server": "workspace:*",
    "@hono-preact/vite":   "workspace:*"
  },
  "peerDependencies": {
    "hono": ">=4.0.0",
    "hoofd": ">=1.0.0",
    "preact": ">=10.0.0",
    "preact-iso": "*",
    "preact-render-to-string": "*",
    "vite": ">=5.0.0"
  },
  "devDependencies": { "typescript": "*" }
}
```

`pnpm publish` rewrites each `workspace:*` to a concrete version range (e.g. `^0.0.1`) at publish time. After publish, the package's `dependencies` block points at real npm versions.

**`packages/iso|server|vite/package.json`:** drop `"private": true`. Existing exports map (already includes `./internal` for iso), peer/dev deps, and scripts are unchanged. Each package's `dist/` is what gets uploaded as its own npm tarball.

## `tsconfig` shapes

The umbrella's tsconfig already exists. No bundler step needed — `tsc` compiles `src/{index,server,vite,internal}.ts` into matching `dist/*.{js,d.ts}` files. Each is a one-line `export * from '@hono-preact/*'` that the TS compiler emits as the same re-export at runtime. Resolution chases through the umbrella's `dependencies` map, which (after pnpm's publish-time rewrite) points at the published `@hono-preact/*` packages.

For dev (monorepo), workspace resolution does the same chain: `hono-preact` → `packages/hono-preact/src/index.ts` → `@hono-preact/iso` → `packages/iso/src/index.ts`.

## Plugin-emit strings

**Unchanged.** Plugin source in `packages/vite/src/{client-entry.ts,server-only.ts,guard-strip.ts}` keeps emitting:

```
import { ... } from '@hono-preact/iso/internal';
import { useAction } from '@hono-preact/iso';
```

These now resolve against the user's installed `@hono-preact/iso` (transitively via `hono-preact`). No migration. Existing plugin unit tests that assert on these strings stay unchanged.

The tradeoff: a user inspecting their bundled JS sees `@hono-preact/iso/internal` references mixed in with their own `hono-preact` imports. The framework treats this as a build-internal detail and the bundle stays semantically correct (resolves to the same module instance regardless of which name is used).

## Demo + docs migration

### Demo (`apps/app/`)

1. **`vite.config.ts` alias block.** **Add** four `hono-preact[/subpath]` aliases pointing at the umbrella's `src/`. **Keep** the existing `@hono-preact/*` aliases — the umbrella's `export * from '@hono-preact/iso'` chains through them in dev so HMR works without per-package builds. Order matters: longest-prefix first within each group.

   ```ts
   resolve: {
     alias: [
       // Umbrella (new)
       { find: 'hono-preact/internal', replacement: resolve(__dirname, '../../packages/hono-preact/src/internal.ts') },
       { find: 'hono-preact/server',   replacement: resolve(__dirname, '../../packages/hono-preact/src/server.ts') },
       { find: 'hono-preact/vite',     replacement: resolve(__dirname, '../../packages/hono-preact/src/vite.ts') },
       { find: 'hono-preact',          replacement: resolve(__dirname, '../../packages/hono-preact/src/index.ts') },
       // Workspace packages (existing, kept so umbrella re-exports chain to src for HMR)
       { find: '@hono-preact/iso/internal', replacement: resolve(__dirname, '../../packages/iso/src/internal.ts') },
       { find: '@hono-preact/iso',          replacement: resolve(__dirname, '../../packages/iso/src/index.ts') },
       { find: '@hono-preact/server',       replacement: resolve(__dirname, '../../packages/server/src/index.ts') },
       { find: '@hono-preact/vite',         replacement: resolve(__dirname, '../../packages/vite/src/index.ts') },
       { find: '@', replacement: resolve(__dirname, './src') },
     ],
   },
   ```

2. **`vite.config.ts:1` import** — `from '@hono-preact/vite'` → `from 'hono-preact/vite'`.

3. **All ~20 import sites under `apps/app/src/`** — search-and-replace `@hono-preact/iso` → `hono-preact`, `@hono-preact/server` → `hono-preact/server`, `@hono-preact/vite` → `hono-preact/vite`.

4. **`apps/app/package.json`** — replace the three `@hono-preact/*` workspace deps with a single `"hono-preact": "workspace:*"`.

### Docs (`apps/app/src/pages/docs/*.mdx`)

~75 references. Same package-name search-and-replace. `vite-config.mdx` gets the most prose rewrites since it's the install/config tutorial.

Hard cutover. No compat layer.

## Testing

### Framework unit tests

Unchanged. All workspace-internal imports stay on `@hono-preact/*` since the workspace packages haven't moved.

### New test in `packages/hono-preact/__tests__/`

**Exports-shape test** (`exports.test.ts`). For each subpath, dynamic-import and assert known public symbols exist with the right `typeof`:

```ts
import * as root from 'hono-preact';
expect(typeof root.definePage).toBe('function');
expect(typeof root.defineLoader).toBe('function');
// ... one assertion per public symbol per subpath
```

Locks down the published surface. Re-shaping the underlying workspace packages will fail this test if a symbol stops flowing through.

No bundle-shape tripwire needed — there's no bundler, no risk of leaked workspace imports.

### Smoke

`pnpm --filter app build` plus a manual `curl /movies` / `/watched` cycle exercise the alias chain end-to-end after migration.

## Migration order

1. Umbrella's `src/` gains `server.ts` and `internal.ts` (one-line re-exports each). Umbrella's `package.json` exports map gains `./server` and `./internal`. Workspace packages flip `private` off.
2. Exports-shape test lands in `packages/hono-preact/__tests__/`.
3. Demo + docs search-and-replace pass.
4. Demo's `vite.config.ts` alias block updates.
5. Demo's `package.json` swaps the three workspace deps for one.
6. Full test suite + prod build + dev-mode smoke.

Each step is verifiable in isolation. Lands as a single PR.

## Out of scope

- **`npm publish` execution** (item 10).
- **README rewrite** (item 10).
- **Pinning a version of the `@hono-preact/*` packages.** `0.0.1` keeps for now; whatever versioning decision lands in item 10 governs.
- **Moving the alias block into `honoPreact()`** so user `vite.config.ts` is one line. Separate item not on the v0.1 burndown.
- **Migrating plugin-emit strings to `hono-preact[/internal]`.** Considered (would remove `@hono-preact/*` from user bundles' resolved imports), rejected: adds a real migration step with negligible user benefit. Bundles work either way.
- **Folding workspace packages into a single src tree.** Considered, rejected: the workspace split documents real internal boundaries (preact-iso runtime ↔ server SSR/RPC ↔ Vite plugins).

## Risks

1. **Version drift between umbrella and internal packages.** Once `0.0.1` is shared, every release has to bump all four packages in lockstep. Mitigation: a pre-publish script (or just `pnpm -r publish` with proper version bump) keeps them aligned.
2. **Subpath ordering bug in the demo's vite alias** could resolve `hono-preact/internal` against the `hono-preact` rule. Caught by demo smoke (internal exports differ from root) and by ordering longest-prefix first.
3. **Stale `@hono-preact/*` references after the migration sweep.** Caught by a final `grep -r '@hono-preact/' apps/app/src apps/app/src/pages/docs` showing zero hits.
