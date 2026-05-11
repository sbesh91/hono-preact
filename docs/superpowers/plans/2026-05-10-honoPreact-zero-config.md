# `honoPreact()` Zero-Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `honoPreact()` accept zero required arguments and own the server entry, so the user's `vite.config.ts` collapses to `defineConfig({ plugins: [honoPreact()] })`. The user's `src/server.tsx` is deleted; custom Hono routes optionally move to `src/api.ts`. Implements item 3 of the v0.1 sequencing per `docs/superpowers/specs/2026-05-10-honoPreact-zero-config-design.md`.

**Architecture:**
- A new `serverEntryPlugin({ viteRoot, layout, routes, api? })` registers a virtual module `virtual:hono-preact/server` whose source is generated from the resolved paths. The plugin uses Vite's `resolveId` and `load` hooks (mirroring `clientShimPlugin`'s pattern) and emits warnings for catch-all routes in `api.ts` via `@babel/parser`.
- `honoPreact()` becomes zero-arg. When `entry` is omitted (the default), the framework adds `serverEntryPlugin` and wires the hono build/dev-server plugins to the virtual module ID.
- `honoPreact()` also adds `preact()` from `@preact/preset-vite` to its plugin list so the user no longer registers it manually.
- The user's `src/api.ts` default-exports a `Hono` instance and is mounted via `app.route('/', userApp)` before the framework's catch-all.

**Tech Stack:** TypeScript, Vite (Plugin API: `resolveId`/`load`/`configResolved`), `@babel/parser`, Vitest, `@preact/preset-vite`, `@hono/vite-build`, `@hono/vite-dev-server`.

**Out of scope for this plan (separate plans cover them):**
- Spec items 4–8 (`<ClientScript />`/`<Head>`/framework client entry, streaming-loader parity, single guards list, package consolidation, README/launch).
- Killing the `import.meta.env.PROD` script-tag ternary in `apps/app/src/server/layout.tsx` (item 4).
- Deleting `apps/app/src/client.tsx` and `apps/app/src/iso.tsx` (item 4).
- Removing the workspace alias block from `apps/app/vite.config.ts` (item 7).
- Documentation rewrites for the doc site (`apps/app/src/pages/docs/*.mdx`). Touched lightly only where the new flow contradicts an existing claim; a full docs pass happens after item 4.

---

## File Map

**Create:**
- `packages/vite/src/server-entry.ts` — `serverEntryPlugin` factory + the pure `generateServerEntrySource` and `findApiCatchAllRoutes` helpers. Single file; cohesive responsibility (everything about the generated server entry).
- `packages/vite/src/__tests__/server-entry.test.ts` — unit tests for `generateServerEntrySource`, `findApiCatchAllRoutes`, and the plugin's `resolveId`/`load` hooks.
- `apps/app/src/api.ts` — the user's custom Hono routes, extracted from `apps/app/src/server.tsx`.

**Modify:**
- `packages/vite/src/hono-preact.ts` — `entry` becomes optional; default path uses `serverEntryPlugin` + the virtual module ID; auto-includes `preact()`.
- `packages/vite/src/index.ts` — export `serverEntryPlugin` for symmetry with the other plugin factories.
- `packages/vite/src/__tests__/hono-preact.test.ts` — extend assembly tests for the new plugin count, the new pipeline order, and the zero-arg call.
- `packages/vite/package.json` — promote `@preact/preset-vite` from `devDependencies` to `peerDependencies` (already present in apps/app, so peer is the right shape; runtime install of `preact` stays a peer too).
- `apps/app/vite.config.ts` — drop `entry: 'src/server.tsx'`, drop `preact()` from the plugins array, drop `import preact from '@preact/preset-vite'`. Keep the workspace alias block (dies at v0.1 §7) and the visualizer block.
- `apps/app/package.json` — remove `dotenv` from `dependencies` (only used in the deleted dev-time block of `server.tsx`).

**Delete:**
- `apps/app/src/server.tsx` — replaced by the generated virtual module.

**Touched lightly (one-line corrections only, full docs rewrite is a later pass):**
- `apps/app/src/pages/docs/vite-config.mdx` — the existing table lists `entry` as required for `honoPreact`; flip to optional with a footnote pointing at the spec.
- `apps/app/src/pages/docs/structure.mdx` — the structure doc currently says the user authors `src/server.tsx`; replace with the new four-file shape.

---

## Task 1: `generateServerEntrySource` pure function (TDD)

Pure string-builder. Takes resolved paths, returns the source for the virtual module. No I/O, no Vite types.

**Files:**
- Create: `packages/vite/src/server-entry.ts`
- Create: `packages/vite/src/__tests__/server-entry.test.ts`

- [ ] **Step 1: Write the failing test (no `api.ts` case)**

In `packages/vite/src/__tests__/server-entry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateServerEntrySource } from '../server-entry.js';

describe('generateServerEntrySource', () => {
  it('emits the framework imports, mounts loaders/actions/location/catchall, omits api when not provided', () => {
    const src = generateServerEntrySource({
      layoutAbsPath: '/proj/src/Layout.tsx',
      routesAbsPath: '/proj/src/routes.ts',
      apiAbsPath: undefined,
    });

    // Framework imports
    expect(src).toContain(`import { Hono } from 'hono';`);
    expect(src).toContain(`import { env } from '@hono-preact/iso';`);
    expect(src).toContain(
      `import {\n  actionsHandler,\n  loadersHandler,\n  location,\n  renderPage,\n  routeServerModules,\n} from '@hono-preact/server';`
    );

    // User imports (absolute paths)
    expect(src).toContain(`import Layout from '/proj/src/Layout.tsx';`);
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);

    // No api import when not provided
    expect(src).not.toContain('api.ts');
    expect(src).not.toContain('userApp');

    // env.current is set
    expect(src).toContain(`env.current = 'server';`);

    // Hono pipeline in correct order
    const loadersIdx = src.indexOf(`'/__loaders'`);
    const actionsIdx = src.indexOf(`'/__actions'`);
    const useLocationIdx = src.indexOf(`.use(location)`);
    const catchallIdx = src.indexOf(`.get('*'`);
    expect(loadersIdx).toBeGreaterThan(-1);
    expect(actionsIdx).toBeGreaterThan(loadersIdx);
    expect(useLocationIdx).toBeGreaterThan(actionsIdx);
    expect(catchallIdx).toBeGreaterThan(useLocationIdx);

    // Default export
    expect(src.trimEnd().endsWith('export default app;')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/vite test -- server-entry
```

Expected: FAIL with `Cannot find module '../server-entry.js'` (or `generateServerEntrySource is not a function`).

- [ ] **Step 3: Implement `generateServerEntrySource`**

Create `packages/vite/src/server-entry.ts`:

```ts
export interface GenerateServerEntrySourceOptions {
  layoutAbsPath: string;
  routesAbsPath: string;
  apiAbsPath: string | undefined;
}

export function generateServerEntrySource(
  opts: GenerateServerEntrySourceOptions
): string {
  const { layoutAbsPath, routesAbsPath, apiAbsPath } = opts;

  const apiImport = apiAbsPath
    ? `import userApp from '${apiAbsPath}';\n`
    : '';
  const apiMount = apiAbsPath ? `  .route('/', userApp)\n` : '';

  return (
    `import { Hono } from 'hono';\n` +
    `import { env } from '@hono-preact/iso';\n` +
    `import {\n` +
    `  actionsHandler,\n` +
    `  loadersHandler,\n` +
    `  location,\n` +
    `  renderPage,\n` +
    `  routeServerModules,\n` +
    `} from '@hono-preact/server';\n` +
    `import Layout from '${layoutAbsPath}';\n` +
    `import routes from '${routesAbsPath}';\n` +
    apiImport +
    `\n` +
    `env.current = 'server';\n` +
    `const serverModules = routeServerModules(routes);\n` +
    `\n` +
    `export const app = new Hono()\n` +
    `  .post('/__loaders', loadersHandler(serverModules))\n` +
    `  .post('/__actions', actionsHandler(serverModules))\n` +
    apiMount +
    `  .use(location)\n` +
    `  .get('*', (c) => renderPage(c, <Layout context={c} />));\n` +
    `\n` +
    `export default app;\n`
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/vite test -- server-entry
```

Expected: PASS.

- [ ] **Step 5: Add the `api.ts` case test**

Append to the same `describe` block:

```ts
  it('emits the api import and mount when apiAbsPath is provided, before the catchall', () => {
    const src = generateServerEntrySource({
      layoutAbsPath: '/proj/src/Layout.tsx',
      routesAbsPath: '/proj/src/routes.ts',
      apiAbsPath: '/proj/src/api.ts',
    });

    expect(src).toContain(`import userApp from '/proj/src/api.ts';`);
    expect(src).toContain(`.route('/', userApp)`);

    // The user's app must be mounted BEFORE the catchall.
    const apiIdx = src.indexOf(`.route('/', userApp)`);
    const catchallIdx = src.indexOf(`.get('*'`);
    expect(apiIdx).toBeGreaterThan(-1);
    expect(catchallIdx).toBeGreaterThan(apiIdx);
  });
```

- [ ] **Step 6: Run the new test (passes without further code changes)**

```bash
pnpm --filter @hono-preact/vite test -- server-entry
```

Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts
git commit -m "feat(vite): pure source generator for the virtual server entry"
```

---

## Task 2: `findApiCatchAllRoutes` AST walker (TDD)

Parses an `api.ts` source string and returns an array of catch-all-shaped warnings. Pure function over a string. Detects:

- `app.get('*', ...)` / `app.all('*', ...)` (and other Hono HTTP methods with literal `'*'`)
- `app.get('/*', ...)` (literal `'/*'`)
- `app.notFound(...)` (any args)

Skips:

- Variable first arg (`app.get(somePath, ...)`)
- `app.use(...)` with no path

**Files:**
- Modify: `packages/vite/src/server-entry.ts`
- Modify: `packages/vite/src/__tests__/server-entry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/vite/src/__tests__/server-entry.test.ts`:

```ts
import { findApiCatchAllRoutes } from '../server-entry.js';

describe('findApiCatchAllRoutes', () => {
  it('flags literal "*" on any HTTP method', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().get('*', (c) => c.text('catch'));
    `;
    const warnings = findApiCatchAllRoutes(src);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'wildcard', method: 'get', pattern: '*' });
  });

  it('flags literal "/*"', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().all('/*', (c) => c.text('catch'));
    `;
    const warnings = findApiCatchAllRoutes(src);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'wildcard', method: 'all', pattern: '/*' });
  });

  it('flags app.notFound(...)', () => {
    const src = `
      import { Hono } from 'hono';
      const app = new Hono();
      app.notFound((c) => c.text('nope', 404));
      export default app;
    `;
    const warnings = findApiCatchAllRoutes(src);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'notFound' });
  });

  it('does not flag variable-arg routes', () => {
    const src = `
      import { Hono } from 'hono';
      const path = '/api/foo';
      export default new Hono().get(path, (c) => c.text('ok'));
    `;
    expect(findApiCatchAllRoutes(src)).toEqual([]);
  });

  it('does not flag pathless app.use(...) middleware', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().use((c, next) => next());
    `;
    expect(findApiCatchAllRoutes(src)).toEqual([]);
  });

  it('does not flag a specific path on a chained call', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono()
        .get('/api/watched/:id/photo', (c) => c.text('ok'))
        .post('/api/watched', (c) => c.text('ok'));
    `;
    expect(findApiCatchAllRoutes(src)).toEqual([]);
  });

  it('returns multiple warnings if multiple catchalls are present', () => {
    const src = `
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('*', (c) => c.text('a'));
      app.notFound((c) => c.text('b'));
      export default app;
    `;
    const warnings = findApiCatchAllRoutes(src);
    expect(warnings).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hono-preact/vite test -- server-entry
```

Expected: FAIL with `findApiCatchAllRoutes is not a function`.

- [ ] **Step 3: Implement `findApiCatchAllRoutes`**

Append to `packages/vite/src/server-entry.ts`:

```ts
import { parse } from '@babel/parser';

export type CatchAllWarning =
  | { kind: 'wildcard'; method: string; pattern: string; line: number | undefined }
  | { kind: 'notFound'; line: number | undefined };

const HONO_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'all',
  'on',
]);

const WILDCARD_PATTERNS = new Set(['*', '/*']);

export function findApiCatchAllRoutes(source: string): CatchAllWarning[] {
  const warnings: CatchAllWarning[] = [];

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    });
  } catch {
    // If api.ts won't parse, the build will fail elsewhere with a clearer
    // error. Don't double-report.
    return warnings;
  }

  walk(ast.program, warnings);
  return warnings;
}

function walk(node: unknown, warnings: CatchAllWarning[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, warnings);
    return;
  }

  const n = node as {
    type?: string;
    callee?: {
      type?: string;
      property?: { type?: string; name?: string };
    };
    arguments?: Array<{ type?: string; value?: unknown }>;
    loc?: { start?: { line?: number } };
  };

  if (
    n.type === 'CallExpression' &&
    n.callee?.type === 'MemberExpression' &&
    n.callee.property?.type === 'Identifier' &&
    typeof n.callee.property.name === 'string'
  ) {
    const method = n.callee.property.name;
    const line = n.loc?.start?.line;

    if (method === 'notFound') {
      warnings.push({ kind: 'notFound', line });
    } else if (HONO_METHODS.has(method)) {
      const firstArg = n.arguments?.[0];
      if (
        firstArg?.type === 'StringLiteral' &&
        typeof firstArg.value === 'string' &&
        WILDCARD_PATTERNS.has(firstArg.value)
      ) {
        warnings.push({
          kind: 'wildcard',
          method,
          pattern: firstArg.value,
          line,
        });
      }
    }
  }

  for (const key of Object.keys(node as object)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    walk((node as Record<string, unknown>)[key], warnings);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hono-preact/vite test -- server-entry
```

Expected: PASS (all tests, including Task 1's).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts
git commit -m "feat(vite): AST walker for api.ts catch-all route warnings"
```

---

## Task 3: `serverEntryPlugin` (TDD)

Wraps the pure helpers in a Vite `Plugin`. Owns the virtual module registration, file-existence check for `api.ts`, and the catch-all warning emission.

The plugin's contract:

- Accepts `{ layout, routes, api }` as project-relative or absolute paths.
- In `configResolved`, resolves them against `viteRoot` (giving absolute paths) and checks `api` for existence (using `node:fs.existsSync`). If `api` is configured but does not exist, it is treated as absent (no error). Reads the `api` source if it exists and emits `this.warn(...)` for each catch-all warning during the `buildStart` hook (so warnings appear once per build, not per import).
- `resolveId(id)` returns `\0virtual:hono-preact/server` for `id === 'virtual:hono-preact/server'`.
- `load(id)` returns the generated source for that resolved id.

**Files:**
- Modify: `packages/vite/src/server-entry.ts`
- Modify: `packages/vite/src/__tests__/server-entry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/vite/src/__tests__/server-entry.test.ts`:

```ts
import { serverEntryPlugin, VIRTUAL_SERVER_ENTRY_ID } from '../server-entry.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

describe('serverEntryPlugin', () => {
  it('exposes the documented virtual id', () => {
    expect(VIRTUAL_SERVER_ENTRY_ID).toBe('virtual:hono-preact/server');
  });

  it('resolveId returns the prefixed id only for the virtual id', () => {
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
    });
    // Simulate Vite firing configResolved with a fake root.
    (plugin as { configResolved?: (c: { root: string }) => void }).configResolved?.({
      root: '/proj',
    });

    const resolved = (plugin as {
      resolveId?: (id: string) => string | undefined;
    }).resolveId?.(VIRTUAL_SERVER_ENTRY_ID);
    expect(resolved).toBe('\0' + VIRTUAL_SERVER_ENTRY_ID);

    const other = (plugin as {
      resolveId?: (id: string) => string | undefined;
    }).resolveId?.('some-other-module');
    expect(other).toBeUndefined();
  });

  it('load() returns the generated source for the resolved virtual id (no api file)', () => {
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts', // configured but does not exist on disk
    });
    (plugin as { configResolved?: (c: { root: string }) => void }).configResolved?.({
      root: '/proj',
    });

    const code = (plugin as {
      load?: (id: string) => string | undefined;
    }).load?.('\0' + VIRTUAL_SERVER_ENTRY_ID);
    expect(code).toContain(`import Layout from '/proj/src/Layout.tsx';`);
    expect(code).toContain(`import routes from '/proj/src/routes.ts';`);
    // Configured api path that doesn't exist is treated as absent.
    expect(code).not.toContain('api.ts');
  });

  it('load() includes api when the file exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nexport default new Hono().get('/api/x', (c) => c.text('ok'));\n`
    );

    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
    });
    (plugin as { configResolved?: (c: { root: string }) => void }).configResolved?.({
      root: tmp,
    });

    const code = (plugin as {
      load?: (id: string) => string | undefined;
    }).load?.('\0' + VIRTUAL_SERVER_ENTRY_ID);
    expect(code).toContain(`import userApp from '${path.join(tmp, 'src', 'api.ts')}';`);
    expect(code).toContain(`.route('/', userApp)`);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildStart emits this.warn for catchall routes in api.ts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nexport default new Hono().get('*', (c) => c.text('catch'));\n`
    );

    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
    });
    (plugin as { configResolved?: (c: { root: string }) => void }).configResolved?.({
      root: tmp,
    });

    const warnings: string[] = [];
    const ctx = { warn: (msg: string) => warnings.push(msg) };
    (plugin as {
      buildStart?: (this: { warn: (m: string) => void }) => void;
    }).buildStart?.call(ctx);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`src/api.ts`);
    expect(warnings[0]).toContain(`catch-all`);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hono-preact/vite test -- server-entry
```

Expected: FAIL with `serverEntryPlugin is not a function` (or `VIRTUAL_SERVER_ENTRY_ID is not exported`).

- [ ] **Step 3: Implement `serverEntryPlugin`**

Append to `packages/vite/src/server-entry.ts`:

```ts
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Plugin } from 'vite';

export const VIRTUAL_SERVER_ENTRY_ID = 'virtual:hono-preact/server';
const RESOLVED_ID = '\0' + VIRTUAL_SERVER_ENTRY_ID;

export interface ServerEntryPluginOptions {
  layout: string;  // project-relative or absolute
  routes: string;
  api: string;     // project-relative or absolute; absence treated as "no api"
}

export function serverEntryPlugin(opts: ServerEntryPluginOptions): Plugin {
  let layoutAbsPath = '';
  let routesAbsPath = '';
  let apiAbsPath: string | undefined;

  return {
    name: 'hono-preact:server-entry',
    enforce: 'pre',
    configResolved(config) {
      layoutAbsPath = path.isAbsolute(opts.layout)
        ? opts.layout
        : path.resolve(config.root, opts.layout);
      routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(config.root, opts.routes);
      const candidateApi = path.isAbsolute(opts.api)
        ? opts.api
        : path.resolve(config.root, opts.api);
      apiAbsPath = fs.existsSync(candidateApi) ? candidateApi : undefined;
    },
    buildStart() {
      if (!apiAbsPath) return;
      const source = fs.readFileSync(apiAbsPath, 'utf8');
      const warnings = findApiCatchAllRoutes(source);
      for (const w of warnings) {
        const where = `${apiAbsPath}${w.line ? `:${w.line}` : ''}`;
        if (w.kind === 'notFound') {
          this.warn(
            `[hono-preact] ${where}: app.notFound(...) acts as a catch-all and ` +
            `will be shadowed by the framework's renderPage handler. ` +
            `Move the behavior to a more specific path, or accept that it won't fire.`
          );
        } else {
          this.warn(
            `[hono-preact] ${where}: app.${w.method}('${w.pattern}', ...) is a ` +
            `catch-all route and will be shadowed by the framework's renderPage ` +
            `handler. Move it to a more specific path, or accept that it won't fire.`
          );
        }
      }
    },
    resolveId(id) {
      if (id === VIRTUAL_SERVER_ENTRY_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      return generateServerEntrySource({
        layoutAbsPath,
        routesAbsPath,
        apiAbsPath,
      });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hono-preact/vite test -- server-entry
```

Expected: PASS (all tests).

- [ ] **Step 5: Export from the package index**

Modify `packages/vite/src/index.ts`:

```ts
export { honoPreact } from './hono-preact.js';
export { serverLoaderValidationPlugin } from './server-loader-validation.js';
export { serverOnlyPlugin, VITE_ROOT_ACCESSOR } from './server-only.js';
export { moduleKeyPlugin } from './module-key-plugin.js';
export { serverEntryPlugin, VIRTUAL_SERVER_ENTRY_ID } from './server-entry.js';
```

- [ ] **Step 6: Run the full vite-package test suite**

```bash
pnpm --filter @hono-preact/vite test
```

Expected: PASS (the existing tests still pass; new server-entry tests pass).

- [ ] **Step 7: Commit**

```bash
git add packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts packages/vite/src/index.ts
git commit -m "feat(vite): serverEntryPlugin registers virtual:hono-preact/server"
```

---

## Task 4: `honoPreact()` accepts zero arguments and wires the virtual entry (TDD)

`entry` becomes optional. When omitted, the framework adds `serverEntryPlugin(...)` to its plugin list and passes `VIRTUAL_SERVER_ENTRY_ID` as the `entry` to `@hono/vite-build/cloudflare-workers` and `@hono/vite-dev-server`. The new `layout`, `routes`, `api` options thread into `serverEntryPlugin`.

When `entry` IS provided (the legacy/advanced path), `serverEntryPlugin` is NOT added; the user owns their server entry.

**Files:**
- Modify: `packages/vite/src/hono-preact.ts`
- Modify: `packages/vite/src/__tests__/hono-preact.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/vite/src/__tests__/hono-preact.test.ts`:

```ts
describe('honoPreact zero-arg path', () => {
  type NamedPlugin = { name?: string; apply?: unknown };

  it('accepts no arguments and includes the server-entry plugin', () => {
    const plugins = honoPreact() as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    expect(names).toContain('hono-preact:server-entry');
  });

  it('omits the server-entry plugin when entry is provided', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' }) as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    expect(names).not.toContain('hono-preact:server-entry');
  });

  it('places server-entry early in the pipeline (before module-key) so its virtual id resolves first', () => {
    const plugins = honoPreact() as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    const seIdx = names.indexOf('hono-preact:server-entry');
    const mkIdx = names.indexOf('module-key');
    expect(seIdx).toBeGreaterThan(-1);
    expect(mkIdx).toBeGreaterThan(-1);
    expect(seIdx).toBeLessThan(mkIdx);
  });
});
```

Also update the existing `'emits exactly seven plugins...'` test (in the same file, in the `honoPreact plugin assembly` describe block) — the count changes when `serverEntryPlugin` is added. Replace:

```ts
  it('emits exactly seven plugins (config, four transforms, build, dev-server)', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    expect(plugins).toHaveLength(7);
  });
```

with:

```ts
  it('emits exactly seven plugins when entry is provided (config, four transforms, build, dev-server)', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    expect(plugins).toHaveLength(7);
  });

  it('emits exactly eight plugins by default (adds server-entry to the seven)', () => {
    const plugins = honoPreact();
    expect(plugins).toHaveLength(8);
  });
```

The `'emits the framework plugins in the documented pipeline order'` test currently locks the first five names. With `entry` provided, it stays the same. Add a parallel test for the zero-arg path:

```ts
  it('emits the documented pipeline order in the zero-arg path', () => {
    const plugins = honoPreact() as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    // server-entry slots in after config and client-shim, before validation/module-key/server-only.
    expect(names.slice(0, 6)).toEqual([
      'hono-preact:config',
      'hono-preact:client-shim',
      'hono-preact:server-entry',
      'server-loader-validation',
      'module-key',
      'server-only',
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hono-preact/vite test -- hono-preact
```

Expected: FAIL — the zero-arg call throws because `entry` is currently required, and the assembly tests find seven plugins where they expected eight.

- [ ] **Step 3: Update `honoPreact()` to make entry optional and wire serverEntryPlugin**

Modify `packages/vite/src/hono-preact.ts`. The full new file:

```ts
import build from '@hono/vite-build/cloudflare-workers';
import devServer, { defaultOptions } from '@hono/vite-dev-server';
import cloudflareAdapter from '@hono/vite-dev-server/cloudflare';
import { type BuildEnvironmentOptions, type Plugin } from 'vite';
import { clientShimPlugin } from './client-shim.js';
import { serverLoaderValidationPlugin } from './server-loader-validation.js';
import { moduleKeyPlugin } from './module-key-plugin.js';
import { serverOnlyPlugin } from './server-only.js';
import {
  serverEntryPlugin,
  VIRTUAL_SERVER_ENTRY_ID,
} from './server-entry.js';

export interface HonoPreactOptions {
  // Source paths (for the generated server entry). All optional.
  layout?: string;       // default 'src/Layout.tsx'
  routes?: string;       // default 'src/routes.ts'
  api?: string;          // default 'src/api.ts' (only loaded if file exists)
  clientEntry?: string;  // default 'src/client.tsx'

  // Server entry. Defaults to a generated virtual module. Rare override.
  entry?: string;

  // Build-tuning escape hatches (preserved).
  clientBuild?: BuildEnvironmentOptions;
  serverBuild?: BuildEnvironmentOptions;
  sharedBuild?: BuildEnvironmentOptions;
}

export function honoPreact(options: HonoPreactOptions = {}): Plugin[] {
  const {
    layout = 'src/Layout.tsx',
    routes = 'src/routes.ts',
    api = 'src/api.ts',
    clientEntry = './src/client.tsx',
    entry,
    clientBuild = {},
    serverBuild = {},
    sharedBuild = {},
  } = options;

  const useGeneratedEntry = entry === undefined;
  const resolvedEntry = entry ?? VIRTUAL_SERVER_ENTRY_ID;

  const configPlugin: Plugin = {
    name: 'hono-preact:config',
    config(_, { mode }) {
      const shared = {
        resolve: {
          dedupe: ['preact', 'preact/compat', 'preact/hooks', 'preact-iso'],
        },
        build: {
          target: 'esnext' as const,
          assetsDir: 'static',
          ssrEmitAssets: true,
          minify: true,
          ...sharedBuild,
        },
      };

      if (mode === 'client') {
        const { rollupOptions: userRollup, ...restClientBuild } = clientBuild;
        return {
          ...shared,
          build: {
            ...shared.build,
            sourcemap: true,
            cssCodeSplit: true,
            copyPublicDir: false,
            ...restClientBuild,
            rollupOptions: {
              input: userRollup?.input ?? [clientEntry],
              output: {
                entryFileNames: 'static/client.js',
                chunkFileNames: 'static/[name]-[hash].js',
                assetFileNames: 'static/[name]-[hash].[ext]',
                ...(userRollup?.output && !Array.isArray(userRollup.output)
                  ? userRollup.output
                  : {}),
              },
            },
          },
        };
      }

      return {
        ...shared,
        ssr: {
          noExternal: [
            'preact-render-to-string',
            'preact-iso',
            '@hono-preact/iso',
            '@hono-preact/server',
          ],
        },
        build: {
          ...shared.build,
          ...serverBuild,
        },
      };
    },
  };

  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    ...(useGeneratedEntry ? [serverEntryPlugin({ layout, routes, api })] : []),
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    serverOnlyPlugin(),
    Object.assign(build({ entry: resolvedEntry }), {
      apply: (_: unknown, { command, mode }: { command: string; mode: string }) =>
        command === 'build' && mode !== 'client',
    }),
    Object.assign(
      devServer({
        entry: resolvedEntry,
        exclude: [
          ...defaultOptions.exclude,
          /\.scss/,
          /\.css/,
          /\?url/,
          /\?inline/,
        ],
        adapter: cloudflareAdapter,
      }),
      { apply: 'serve' as const }
    ),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hono-preact/vite test
```

Expected: PASS (all tests, both the new ones and the updated assembly tests).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/hono-preact.ts packages/vite/src/__tests__/hono-preact.test.ts
git commit -m "feat(vite): honoPreact() accepts zero args, wires generated server entry"
```

---

## Task 5: `honoPreact()` auto-includes `preact()` (TDD)

The user no longer registers `@preact/preset-vite` themselves. `honoPreact()` adds it to the plugin list. Note: `@preact/preset-vite` returns an array of plugins, not a single one, so the integration spreads it.

**Files:**
- Modify: `packages/vite/src/hono-preact.ts`
- Modify: `packages/vite/src/__tests__/hono-preact.test.ts`
- Modify: `packages/vite/package.json`

- [ ] **Step 1: Promote `@preact/preset-vite` from devDependencies to peerDependencies**

The user app already depends on `@preact/preset-vite` directly (it's in `apps/app/package.json`). After this change, the user no longer imports it; `honoPreact()` does. Make it a peer so end-users still install it (the framework doesn't bundle it) but it's a documented framework dependency.

Modify `packages/vite/package.json`:

```jsonc
{
  // ...
  "peerDependencies": {
    "@hono/vite-build": "^1.11.1",
    "@hono/vite-dev-server": "^0.25.1",
    "@preact/preset-vite": "^2.10.5",
    "vite": ">=5.0.0"
  },
  "devDependencies": {
    // remove @preact/preset-vite from here
    "preact": "^10.29.1",
    "preact-iso": "github:preactjs/preact-iso#v3",
    "typescript": "*",
    "vite": "*"
  }
}
```

- [ ] **Step 2: Run pnpm install to refresh the lockfile**

```bash
pnpm install
```

Expected: lockfile updates without errors.

- [ ] **Step 3: Write the failing test**

Append to `packages/vite/src/__tests__/hono-preact.test.ts`:

```ts
describe('honoPreact preact() auto-inclusion', () => {
  type NamedPlugin = { name?: string };

  it('includes the preact preset plugins by name', () => {
    const plugins = honoPreact() as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    // @preact/preset-vite returns multiple named plugins; the JSX-transform
    // plugin is the most stable name to assert on.
    expect(names).toContain('vite:preact-jsx');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/vite test -- hono-preact
```

Expected: FAIL — `vite:preact-jsx` not found in the plugin list.

- [ ] **Step 5: Wire `preact()` into the plugin list**

Modify `packages/vite/src/hono-preact.ts`:

Add the import:

```ts
import preact from '@preact/preset-vite';
```

Append the spread inside the returned array (after the dev-server plugin):

```ts
  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    ...(useGeneratedEntry ? [serverEntryPlugin({ layout, routes, api })] : []),
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    serverOnlyPlugin(),
    Object.assign(build({ entry: resolvedEntry }), {
      apply: (_: unknown, { command, mode }: { command: string; mode: string }) =>
        command === 'build' && mode !== 'client',
    }),
    Object.assign(
      devServer({
        entry: resolvedEntry,
        exclude: [
          ...defaultOptions.exclude,
          /\.scss/,
          /\.css/,
          /\?url/,
          /\?inline/,
        ],
        adapter: cloudflareAdapter,
      }),
      { apply: 'serve' as const }
    ),
    ...preact(),
  ];
```

- [ ] **Step 6: Update the plugin-count tests**

The plugin count rises by however many plugins `@preact/preset-vite` returns. Rather than locking that number (it can change across preset releases), relax the assertions to bound it. Replace:

```ts
  it('emits exactly seven plugins when entry is provided (config, four transforms, build, dev-server)', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    expect(plugins).toHaveLength(7);
  });

  it('emits exactly eight plugins by default (adds server-entry to the seven)', () => {
    const plugins = honoPreact();
    expect(plugins).toHaveLength(8);
  });
```

with:

```ts
  it('emits at least seven framework-owned plugins when entry is provided', () => {
    // 7 framework plugins (config, client-shim, validation, module-key,
    // server-only, build, dev-server) plus an unknown number of preact
    // preset plugins.
    const plugins = honoPreact({ entry: './src/server.tsx' });
    expect(plugins.length).toBeGreaterThanOrEqual(7);
  });

  it('adds exactly one more framework-owned plugin in the zero-arg path (server-entry)', () => {
    const withEntry = honoPreact({ entry: './src/server.tsx' });
    const zeroArg = honoPreact();
    expect(zeroArg.length).toBe(withEntry.length + 1);
  });
```

- [ ] **Step 7: Run all tests**

```bash
pnpm --filter @hono-preact/vite test
```

Expected: PASS (all tests, including the new preact-detection test and the relaxed count tests).

- [ ] **Step 8: Commit**

```bash
git add packages/vite/package.json packages/vite/src/hono-preact.ts packages/vite/src/__tests__/hono-preact.test.ts pnpm-lock.yaml
git commit -m "feat(vite): honoPreact() auto-includes @preact/preset-vite"
```

---

## Task 6: Extract `apps/app/src/api.ts` from the user-authored server.tsx

The custom Hono route in today's `server.tsx` (`/api/watched/:movieId/photo`) moves to `apps/app/src/api.ts`. This task creates the new file but does NOT yet delete `server.tsx` or change `vite.config.ts` — those happen in Task 7 so the demo stays runnable between commits.

**Files:**
- Create: `apps/app/src/api.ts`

- [ ] **Step 1: Create `apps/app/src/api.ts`**

```ts
import { Hono } from 'hono';
import { getWatched } from './server/watched.js';

export default new Hono().get(
  '/api/watched/:movieId/photo',
  async (c) => {
    const id = Number(c.req.param('movieId'));
    if (!Number.isFinite(id)) return c.notFound();
    const rec = await getWatched(id);
    if (!rec?.photo) return c.notFound();
    return new Response(
      new Blob([rec.photo.bytes], { type: rec.photo.contentType }),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
);
```

- [ ] **Step 2: Verify the file typechecks**

```bash
pnpm --filter app exec tsc --noEmit
```

Expected: PASS — `api.ts` is well-typed; the rest of the app is unchanged so its existing pass/fail state is preserved.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/api.ts
git commit -m "feat(app): extract /api/watched/:movieId/photo into src/api.ts"
```

---

## Task 7: Delete `server.tsx`, simplify `vite.config.ts`, remove `dotenv` dep

The cutover. After this commit, the demo runs against the generated virtual server entry.

**Files:**
- Delete: `apps/app/src/server.tsx`
- Modify: `apps/app/vite.config.ts`
- Modify: `apps/app/package.json` (drop `dotenv` runtime dep)

- [ ] **Step 1: Delete `apps/app/src/server.tsx`**

```bash
git rm apps/app/src/server.tsx
```

- [ ] **Step 2: Simplify `apps/app/vite.config.ts`**

Replace the current file with:

```ts
import { honoPreact } from '@hono-preact/vite';
import mdx, { type Options as MdxOptions } from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import rehypeShiki from '@shikijs/rehype';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

const mdxOptions = {
  jsxImportSource: 'preact',
  remarkPlugins: [remarkGfm],
  rehypePlugins: [
    [
      rehypeShiki,
      { theme: 'github-dark', langs: ['ts', 'tsx', 'bash', 'jsonc', 'mdx'] },
    ],
  ],
} satisfies MdxOptions;

const visualize = process.env.VISUALIZE === '1';

export default defineConfig((env) => ({
  resolve: {
    alias: [
      // Workspace aliases for monorepo dev. Removed at v0.1 §7 (package consolidation).
      {
        find: '@hono-preact/iso/internal',
        replacement: resolve(__dirname, '../../packages/iso/src/internal.ts'),
      },
      {
        find: '@hono-preact/iso',
        replacement: resolve(__dirname, '../../packages/iso/src/index.ts'),
      },
      {
        find: '@hono-preact/server',
        replacement: resolve(__dirname, '../../packages/server/src/index.ts'),
      },
      { find: '@', replacement: resolve(__dirname, './src') },
    ],
  },
  build: {
    sourcemap: visualize && env.mode === 'client',
  },
  plugins: [
    honoPreact(),
    Object.assign(mdx(mdxOptions), { enforce: 'pre' as const }),
    ...(visualize && env.mode === 'client'
      ? [
          visualizer({
            open: true,
            filename: 'dist/stats.html',
            sourcemap: true,
            gzipSize: true,
          }),
        ]
      : []),
  ],
}));
```

What changed:
- Dropped `import preact from '@preact/preset-vite';`.
- Dropped `preact()` from the plugins array (now inside `honoPreact()`).
- Dropped `entry: 'src/server.tsx'` from the `honoPreact()` call (zero-arg).

- [ ] **Step 3: Remove `dotenv` from `apps/app/package.json`**

`dotenv` was only used in the deleted dev-time block of `server.tsx`. Remove it from `dependencies`:

```jsonc
{
  // ... in apps/app/package.json
  "dependencies": {
    "@hono-preact/iso": "workspace:*",
    "@hono-preact/server": "workspace:*",
    "@shikijs/rehype": "^4.0.2",
    // dotenv removed
    "hono": "^4.12.14",
    // ... rest unchanged
  }
}
```

- [ ] **Step 4: Refresh the lockfile**

```bash
pnpm install
```

Expected: lockfile updates; no errors.

- [ ] **Step 5: Typecheck the app**

```bash
pnpm --filter app exec tsc --noEmit
```

Expected: PASS. (If TS6133 unused-import errors surface from prior code, they are pre-existing and out of scope for this plan; note them and continue.)

- [ ] **Step 6: Run dev server, smoke-test the demo**

```bash
pnpm --filter app dev
```

Then in a browser open `http://localhost:5173/` (or whatever port Vite reports) and verify:

| Check | Pass criteria |
|---|---|
| Home page renders | `/` shows the home view, no console errors. |
| Movies list renders | `/movies` shows the movies list (loader fired). |
| Movie detail renders | `/movies/1` shows the movie detail (loader fired). |
| Watched page renders | `/watched` shows the watched page. |
| Toggle watched (action) | Clicking a "watched" toggle updates state, both the list and `/watched` reflect the change after navigation (cross-route invalidation). |
| Photo endpoint | `GET /api/watched/1/photo` returns image bytes (or `404` if no photo set). Verify with `curl -I http://localhost:5173/api/watched/1/photo`. |
| SSR HTML | `curl http://localhost:5173/movies` returns server-rendered HTML containing the layout and the list. |

Stop the dev server (Ctrl-C) once verified.

- [ ] **Step 7: Production build**

```bash
pnpm --filter app build
```

Expected: PASS. Both the client build (`vite build --mode client`) and the SSR build (`vite build`) complete without errors.

- [ ] **Step 8: Sanity-check the build output**

```bash
ls apps/app/dist/static/ | head
ls apps/app/dist/
```

Expected: `dist/static/client.js` exists; `dist/index.js` (or whichever filename @hono/vite-build emits) exists.

- [ ] **Step 9: Commit**

```bash
git add apps/app/vite.config.ts apps/app/package.json pnpm-lock.yaml
git commit -m "feat(app): drop server.tsx; vite.config.ts collapses to honoPreact()"
```

---

## Task 8: Update existing docs to reflect the new flow

The doc site claims the user authors `src/server.tsx` and that `honoPreact` requires `entry`. Both are now wrong. Targeted one-liner corrections only; a full docs pass is a separate plan.

**Files:**
- Modify: `apps/app/src/pages/docs/structure.mdx`
- Modify: `apps/app/src/pages/docs/vite-config.mdx`

- [ ] **Step 1: Find the stale claims**

Use the Grep tool to locate the lines that need correction:

```
Grep pattern: "server\\.tsx|honoPreact\\(\\{" path: apps/app/src/pages/docs
```

Expected hits include `structure.mdx` (where it lists `src/server.tsx` as a user-authored file) and `vite-config.mdx` (where it shows `honoPreact({ entry })` as the call site).

- [ ] **Step 2: Update `structure.mdx`**

Wherever the doc lists `src/server.tsx` as a user-authored file, replace with a note that the framework generates the server entry as a virtual module (`virtual:hono-preact/server`) and that `src/api.ts` is the optional file for custom Hono routes. Keep the change minimal: one sentence in the existing paragraph, not a new section.

- [ ] **Step 3: Update `vite-config.mdx`**

Wherever the doc shows `honoPreact({ entry: 'src/server.tsx' })`, replace with `honoPreact()` and a parenthetical noting that `entry` is an advanced override. Wherever the table or text claims `entry` is required, mark it optional.

- [ ] **Step 4: Verify docs still build**

```bash
pnpm --filter app build
```

Expected: PASS (MDX compiles; no broken anchors).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/docs/structure.mdx apps/app/src/pages/docs/vite-config.mdx
git commit -m "docs: reflect zero-arg honoPreact() and generated server entry"
```

---

## Task 9: Final verification pass

A whole-repo sanity check before considering item 3 done.

- [ ] **Step 1: Run the full vite-package test suite**

```bash
pnpm --filter @hono-preact/vite test
```

Expected: PASS.

- [ ] **Step 2: Run the iso-package and server-package test suites**

```bash
pnpm --filter @hono-preact/iso test
pnpm --filter @hono-preact/server test
```

Expected: PASS (unchanged by this plan, but confirm no regressions).

- [ ] **Step 3: Typecheck the workspace**

```bash
pnpm -r exec tsc --noEmit
```

Expected: PASS for framework packages. App may have pre-existing errors; note them.

- [ ] **Step 4: Build the app**

```bash
pnpm --filter app build
```

Expected: PASS. Both client and SSR builds succeed.

- [ ] **Step 5: Update the v0.1 burndown memory**

This is a memory update, not a commit. After integration, the v0.1 sequencing memory at `/Users/stevenbeshensky/.claude/projects/-Users-stevenbeshensky-Documents-repos-hono-preact/memory/project_v01_sequencing.md` should mark item 3 as ✅ with the merge commit SHA. (Do this when the PR merges, not as part of the implementation.)

---

## Risks and contingencies

**Risk 1: `@hono/vite-build/cloudflare-workers` does not accept a virtual module ID as `entry`.**

If the production build fails at Task 7 step 7 with an error like "Cannot find entry module 'virtual:hono-preact/server'" or similar, pivot to an on-disk generated file:

- In `serverEntryPlugin.configResolved`, write the generated source to `path.resolve(config.cacheDir, 'hono-preact', 'server-entry.tsx')` (creating the dir if needed).
- Export the resolved file path from the plugin (e.g., a getter or a side-channel object).
- In `honoPreact()`, after instantiating `serverEntryPlugin`, read that path and pass it as the `entry` to `build(...)` and `devServer(...)` instead of `VIRTUAL_SERVER_ENTRY_ID`.
- Tests change correspondingly: the plugin no longer registers `resolveId`/`load`; instead the test asserts the file is written to the cache dir.

This is a ~30 LOC swap, contained in `server-entry.ts` and `hono-preact.ts`. The pure helpers (`generateServerEntrySource`, `findApiCatchAllRoutes`) are unaffected.

**Risk 2: `@hono/vite-dev-server` does not accept the virtual ID either.**

Same pivot as Risk 1; the on-disk file works for both.

**Risk 3: Absolute paths in the generated source break Vite's resolver in build mode.**

If the build fails with "Cannot resolve '/proj/src/Layout.tsx'" or similar (paths starting with `/` in user code typically work in dev but can fail in build), swap to file-URL imports (`file:///proj/src/Layout.tsx`) or use Vite's `\0`-prefixed virtual imports indirectly through the plugin's `resolveId` hook. This too is a contained change.

**Risk 4: TS6133 / TS7031 errors surface from `apps/app/src/pages/movie.server.ts` (pre-existing; flagged in the loader-method-refs plan).**

These are unrelated to this plan. If they block `tsc --noEmit`, fix them inline as drive-bys (remove unused imports, type the `location` parameter explicitly) and note in the commit message. Don't expand the plan's scope further.

---

## Self-review checklist

- ✅ Spec coverage: every numbered design section in `2026-05-10-honoPreact-zero-config-design.md` has at least one task. (API → Tasks 4-5; generated server entry → Tasks 1, 3; api.ts contract + warning → Tasks 2, 3, 6; demo migration → Tasks 6-7; behavior parity → Task 7 step 6; out-of-scope items explicitly excluded above.)
- ✅ No placeholders: every step has actual code or actual commands; no "TBD", "implement later", "add appropriate handling".
- ✅ Type consistency: `VIRTUAL_SERVER_ENTRY_ID` used consistently across Tasks 3-4; `serverEntryPlugin` signature matches across export, test, and consumer; `HonoPreactOptions` field names match across the spec, the function definition, and the test file.
- ✅ TDD throughout: Tasks 1-5 follow red-green-commit; Tasks 6-9 are integration/migration where TDD doesn't apply but verification commands are spelled out.
- ✅ Frequent commits: nine task-level commits, each leaving the repo in a runnable state.
