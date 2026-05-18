# Reserved-path middleware: mount user app on top — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users apply HTTP middleware (e.g. `csrf()`) to the framework's reserved RPC paths by mounting the user's `api.ts` app ahead of the framework handlers in the generated server entry.

**Architecture:** The generated server entry currently registers `POST /__loaders` and `POST /__actions` before `.route('/', userApp)`. Hono composes matched handlers in registration order, so user middleware never runs before the reserved-path handlers. We flip the order (user app first), and replace the lost "user code cannot shadow reserved paths" structural guarantee with build-time detection that fails the build on catch-all routes and literal reserved-path registrations in `api.ts`.

**Tech Stack:** TypeScript, Vite plugin API (Rollup `PluginContext`), `@babel/parser` for static analysis of `api.ts`, Hono, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-17-reserved-path-middleware-design.md`

---

## File Structure

- `packages/vite/src/server-entry.ts` — modified. `generateServerEntrySource` reorders the mount; the `CatchAllWarning` type and `findApiCatchAllRoutes` walker are renamed and extended; `serverEntryPlugin`'s `buildStart` switches severity between `this.warn` and `this.error`.
- `packages/vite/src/__tests__/server-entry.test.ts` — modified. Updated assertions for the new order, the renamed/extended detector, and the error-vs-warn `buildStart` behavior; new mount-order composition test.
- `apps/site/src/pages/docs/csrf.mdx` — modified. Note that the recipe works because the user app mounts ahead of reserved paths; note `api.ts` middleware is effectively app-wide.
- `docs/superpowers/research/2026-05-14-hono-primitives-audit.md` — modified. Correct the now-false `hono/csrf` claim and annotate recommendation 1.

---

## Task 1: Reorder the generated server entry

**Files:**
- Modify: `packages/vite/src/server-entry.ts:43-50` (`generateServerEntrySource` return value)
- Test: `packages/vite/src/__tests__/server-entry.test.ts:74-89`

- [ ] **Step 1: Update the failing test**

Replace the test at `server-entry.test.ts:74-89` (`it('emits the api import and mount when apiAbsPath is provided, before the catchall', ...)`) with:

```ts
  it('emits the api import and mounts userApp before the reserved paths and catchall', () => {
    const src = generateServerEntrySource({
      layoutAbsPath: '/proj/src/Layout.tsx',
      routesAbsPath: '/proj/src/routes.ts',
      apiAbsPath: '/proj/src/api.ts',
    });

    expect(src).toContain(`import userApp from '/proj/src/api.ts';`);
    expect(src).toContain(`.route('/', userApp)`);

    // The user's app must be mounted BEFORE the reserved paths so that
    // middleware registered in api.ts composes ahead of loadersHandler /
    // actionsHandler. See docs/superpowers/specs/2026-05-17-reserved-path-middleware-design.md
    const apiIdx = src.indexOf(`.route('/', userApp)`);
    const loadersIdx = src.indexOf(`'/__loaders'`);
    const actionsIdx = src.indexOf(`'/__actions'`);
    const catchallIdx = src.indexOf(`.get('*'`);
    expect(apiIdx).toBeGreaterThan(-1);
    expect(loadersIdx).toBeGreaterThan(apiIdx);
    expect(actionsIdx).toBeGreaterThan(loadersIdx);
    expect(catchallIdx).toBeGreaterThan(actionsIdx);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts -t "mounts userApp before"`
Expected: FAIL — `loadersIdx` is currently less than `apiIdx` (api is mounted after the reserved paths).

- [ ] **Step 3: Reorder the mount in `generateServerEntrySource`**

In `packages/vite/src/server-entry.ts`, the return value currently ends:

```ts
    `export const app = new Hono()\n` +
    `  .post('/__loaders', loadersHandler(serverModules, handlerOpts))\n` +
    `  .post('/__actions', actionsHandler(serverModules, handlerOpts))\n` +
    apiMount +
    `  .get('*', (c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes })))));\n` +
```

Move `apiMount` above the two `.post(...)` lines:

```ts
    `export const app = new Hono()\n` +
    apiMount +
    `  .post('/__loaders', loadersHandler(serverModules, handlerOpts))\n` +
    `  .post('/__actions', actionsHandler(serverModules, handlerOpts))\n` +
    `  .get('*', (c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes })))));\n` +
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts`
Expected: PASS — all `generateServerEntrySource` and `serverEntryPlugin` tests green (the no-api test and the existing `buildStart` tests are unaffected by the reorder).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts
git commit -m "feat(vite): mount user api app ahead of reserved RPC paths"
```

---

## Task 2: Mount-order composition regression test

This is a **characterization test**: it exercises Hono's composition semantics plus the order Task 1 produces, so it passes as soon as it is written (there is no red phase — it is a regression guard documenting *why* the order matters).

**Files:**
- Test: `packages/vite/src/__tests__/server-entry.test.ts` (append a new `describe` block)

- [ ] **Step 1: Add the composition test**

Append this `describe` block at the end of `packages/vite/src/__tests__/server-entry.test.ts`:

```ts
describe('mount-order composition (why api.ts is mounted first)', () => {
  it('middleware in the user app guards the reserved /__actions path', async () => {
    const { Hono } = await import('hono');
    const { csrf } = await import('hono/csrf');

    let actionRan = false;
    const userApp = new Hono();
    userApp.use('*', csrf({ origin: 'https://example.com' }));

    // Mirrors the order generateServerEntrySource emits: userApp first.
    const app = new Hono()
      .route('/', userApp)
      .post('/__actions', (c) => {
        actionRan = true;
        return c.json({ ok: true });
      });

    // Cross-origin form post: csrf rejects before the action handler runs.
    const blocked = await app.request('https://example.com/__actions', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'x=1',
    });
    expect(blocked.status).toBe(403);
    expect(actionRan).toBe(false);

    // Same-origin form post: passes csrf, reaches the action handler.
    const ok = await app.request('https://example.com/__actions', {
      method: 'POST',
      headers: {
        Origin: 'https://example.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'x=1',
    });
    expect(ok.status).toBe(200);
    expect(actionRan).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts -t "middleware in the user app guards"`
Expected: PASS. If it fails, the assumption behind Task 1 is wrong — stop and re-check `hono/csrf` behavior before continuing.

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/__tests__/server-entry.test.ts
git commit -m "test(vite): pin that user-app middleware guards reserved RPC paths"
```

---

## Task 3: Extend shadow detection — rename, severity, reserved paths, `.on()` fix

Rename `findApiCatchAllRoutes` to `findApiShadowingRoutes` and `CatchAllWarning` to `ApiShadowingRoute`; add a `severity` field; detect literal reserved-path registrations; fix the `.on()` path-argument index.

**Files:**
- Modify: `packages/vite/src/server-entry.ts:53-173` (type, constants, `findApiCatchAllRoutes`, `walk`)
- Test: `packages/vite/src/__tests__/server-entry.test.ts:92-183` (`findApiCatchAllRoutes` describe block)

- [ ] **Step 1: Update the detector tests**

Replace the entire `describe('findApiCatchAllRoutes', ...)` block (`server-entry.test.ts:92-183`) with:

```ts
describe('findApiShadowingRoutes', () => {
  it('flags literal "*" on any HTTP method as an error', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().get('*', (c) => c.text('catch'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'wildcard',
      method: 'get',
      pattern: '*',
      severity: 'error',
    });
  });

  it('flags literal "/*" as an error', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().all('/*', (c) => c.text('catch'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'wildcard',
      method: 'all',
      pattern: '/*',
      severity: 'error',
    });
  });

  it('flags an app.on() catch-all (path is the second argument)', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().on('GET', '*', (c) => c.text('catch'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'wildcard',
      method: 'on',
      pattern: '*',
      severity: 'error',
    });
  });

  it('flags a literal /__actions registration as a reserved-path error', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().post('/__actions', (c) => c.text('mine'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'reserved',
      method: 'post',
      pattern: '/__actions',
      severity: 'error',
    });
  });

  it('flags a literal /__loaders registration as a reserved-path error', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().get('/__loaders', (c) => c.text('mine'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'reserved',
      method: 'get',
      pattern: '/__loaders',
      severity: 'error',
    });
  });

  it('flags app.notFound(...) as a warning, not an error', () => {
    const src = `
      import { Hono } from 'hono';
      const app = new Hono();
      app.notFound((c) => c.text('nope', 404));
      export default app;
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'notFound', severity: 'warning' });
  });

  it('does not flag variable-arg routes', () => {
    const src = `
      import { Hono } from 'hono';
      const path = '/api/foo';
      export default new Hono().get(path, (c) => c.text('ok'));
    `;
    expect(findApiShadowingRoutes(src)).toEqual([]);
  });

  it('does not flag pathless app.use(...) middleware', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().use((c, next) => next());
    `;
    expect(findApiShadowingRoutes(src)).toEqual([]);
  });

  it('does not flag a specific path on a chained call', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono()
        .get('/api/watched/:id/photo', (c) => c.text('ok'))
        .post('/api/watched', (c) => c.text('ok'));
    `;
    expect(findApiShadowingRoutes(src)).toEqual([]);
  });

  it('returns multiple entries if multiple shadowing routes are present', () => {
    const src = `
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('*', (c) => c.text('a'));
      app.notFound((c) => c.text('b'));
      export default app;
    `;
    expect(findApiShadowingRoutes(src)).toHaveLength(2);
  });

  it('does not flag c.notFound() inside a handler body', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().get('/api/x/:id', (c) => {
        const id = Number(c.req.param('id'));
        if (!Number.isFinite(id)) return c.notFound();
        return c.text('ok');
      });
    `;
    expect(findApiShadowingRoutes(src)).toEqual([]);
  });
});
```

- [ ] **Step 2: Update the import in the test file**

In `server-entry.test.ts:5-11`, change `findApiCatchAllRoutes` to `findApiShadowingRoutes` in the import from `'../server-entry.js'`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts -t "findApiShadowingRoutes"`
Expected: FAIL — `findApiShadowingRoutes` is not exported yet.

- [ ] **Step 4: Replace the type and add the reserved-paths constant**

In `packages/vite/src/server-entry.ts`, replace the `CatchAllWarning` type (lines 53-60):

```ts
export type CatchAllWarning =
  | {
      kind: 'wildcard';
      method: string;
      pattern: string;
      line: number | undefined;
    }
  | { kind: 'notFound'; line: number | undefined };
```

with:

```ts
export type ApiShadowingRoute =
  | {
      kind: 'wildcard';
      method: string;
      pattern: string;
      line: number | undefined;
      severity: 'error';
    }
  | {
      kind: 'reserved';
      method: string;
      pattern: string;
      line: number | undefined;
      severity: 'error';
    }
  | { kind: 'notFound'; line: number | undefined; severity: 'warning' };

// Framework-reserved request paths. A literal registration of either in
// api.ts shadows the framework's RPC handler now that the user app mounts
// ahead of them.
const RESERVED_PATHS = new Set(['/__loaders', '/__actions']);
```

- [ ] **Step 5: Replace `findApiCatchAllRoutes` with `findApiShadowingRoutes`**

Replace the function (lines 87-113) — only the name, the result type, and the local variable change:

```ts
export function findApiShadowingRoutes(source: string): ApiShadowingRoute[] {
  const found: ApiShadowingRoute[] = [];

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: BABEL_PARSER_PLUGINS,
      errorRecovery: true,
    });
  } catch (err) {
    // If api.ts won't parse, the build will fail elsewhere with a clearer
    // error. Surface a note so the framework user can correlate a missing
    // shadowing warning with a parse-time syntax issue rather than wondering
    // why nothing was reported.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[hono-preact] Failed to parse api.ts for shadowing-route detection: ${msg}. ` +
        `The build will surface the real syntax error; this warning explains why ` +
        `route-overlap diagnostics may be missing.`
    );
    return found;
  }

  walk(ast.program, found);
  return found;
}
```

- [ ] **Step 6: Update the `walk` function**

Replace the `walk` function (lines 115-173). The signature's array type and the `CallExpression` handling change; the recursion is unchanged except the parameter name:

```ts
function walk(node: unknown, found: ApiShadowingRoute[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, found);
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
      found.push({ kind: 'notFound', line, severity: 'warning' });
    } else if (HONO_METHODS.has(method)) {
      // `app.on(method, path, ...)` puts the path at argument index 1;
      // every other Hono routing method takes the path as argument 0.
      const pathArg = n.arguments?.[method === 'on' ? 1 : 0];
      if (
        pathArg?.type === 'StringLiteral' &&
        typeof pathArg.value === 'string'
      ) {
        if (WILDCARD_PATTERNS.has(pathArg.value)) {
          found.push({
            kind: 'wildcard',
            method,
            pattern: pathArg.value,
            line,
            severity: 'error',
          });
        } else if (RESERVED_PATHS.has(pathArg.value)) {
          found.push({
            kind: 'reserved',
            method,
            pattern: pathArg.value,
            line,
            severity: 'error',
          });
        }
      }
    }
  }

  const isFunctionParent =
    typeof n.type === 'string' && FUNCTION_BODY_PARENTS.has(n.type);

  for (const key of Object.keys(node as object)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'trailingComments'
    )
      continue;
    if (isFunctionParent && key === 'body') continue;
    walk((node as Record<string, unknown>)[key], found);
  }
}
```

- [ ] **Step 7: Run the detector tests to verify they pass**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts -t "findApiShadowingRoutes"`
Expected: PASS (all 11 tests).

Note: `buildStart` still calls the old name — `pnpm exec tsc` would fail right now. That is fixed in Task 4. Do not commit yet.

- [ ] **Step 8: Commit (with Task 4)**

The `buildStart` caller is updated in Task 4; commit both together there.

---

## Task 4: `buildStart` — fail the build on errors, warn on warnings

**Files:**
- Modify: `packages/vite/src/server-entry.ts:246-264` (the `buildStart` warning loop)
- Test: `packages/vite/src/__tests__/server-entry.test.ts:290-329` (the catch-all `buildStart` test)

- [ ] **Step 1: Replace the catch-all `buildStart` test with error + warning tests**

Replace the test at `server-entry.test.ts:290-329` (`it('buildStart emits this.warn for catchall routes in api.ts', ...)`) with these three tests:

```ts
  it('buildStart throws via this.error for a catch-all route in api.ts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nexport default new Hono().get('*', (c) => c.text('catch'));\n`
    );
    const outputPath = path.join(
      tmp,
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      outputPath,
    });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({ root: tmp });

    // Rollup's this.error throws; mimic that.
    const ctx = {
      warn: () => {},
      error: (m: unknown) => {
        throw new Error(typeof m === 'string' ? m : String(m));
      },
    };
    expect(() =>
      (plugin as { buildStart?: (this: typeof ctx) => void }).buildStart?.call(
        ctx
      )
    ).toThrow(/catch-all/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildStart throws via this.error for a literal /__actions registration', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nexport default new Hono().post('/__actions', (c) => c.text('mine'));\n`
    );
    const outputPath = path.join(
      tmp,
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      outputPath,
    });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({ root: tmp });

    const ctx = {
      warn: () => {},
      error: (m: unknown) => {
        throw new Error(typeof m === 'string' ? m : String(m));
      },
    };
    expect(() =>
      (plugin as { buildStart?: (this: typeof ctx) => void }).buildStart?.call(
        ctx
      )
    ).toThrow(/reserved/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildStart warns (does not throw) for app.notFound in api.ts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nconst app = new Hono();\napp.notFound((c) => c.text('nope', 404));\nexport default app;\n`
    );
    const outputPath = path.join(
      tmp,
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      outputPath,
    });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({ root: tmp });

    const warnings: string[] = [];
    const ctx = {
      warn: (m: string) => warnings.push(m),
      error: (m: unknown) => {
        throw new Error(typeof m === 'string' ? m : String(m));
      },
    };
    expect(() =>
      (plugin as { buildStart?: (this: typeof ctx) => void }).buildStart?.call(
        ctx
      )
    ).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('notFound');

    fs.rmSync(tmp, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts -t "buildStart"`
Expected: FAIL — `buildStart` still calls the removed `findApiCatchAllRoutes` and uses `this.warn` for catch-alls.

- [ ] **Step 3: Update `buildStart`**

In `packages/vite/src/server-entry.ts`, replace the block from `if (!apiAbsPath) return;` through the end of the `for` loop (lines 246-264):

```ts
      if (!apiAbsPath) return;
      const apiSource = fs.readFileSync(apiAbsPath, 'utf8');
      const warnings = findApiCatchAllRoutes(apiSource);
      for (const w of warnings) {
        const where = `${apiAbsPath}${w.line != null ? `:${w.line}` : ''}`;
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
```

with:

```ts
      if (!apiAbsPath) return;
      const apiSource = fs.readFileSync(apiAbsPath, 'utf8');
      const shadowing = findApiShadowingRoutes(apiSource);
      const errors: string[] = [];
      for (const r of shadowing) {
        const where = `${apiAbsPath}${r.line != null ? `:${r.line}` : ''}`;
        if (r.kind === 'notFound') {
          this.warn(
            `[hono-preact] ${where}: app.notFound(...) will not fire — the ` +
              `framework's renderPage handler matches every unmatched request. ` +
              `Move the behavior to a specific path, or accept that it won't fire.`
          );
        } else if (r.kind === 'wildcard') {
          errors.push(
            `${where}: app.${r.method}('${r.pattern}', ...) is a catch-all route`
          );
        } else {
          errors.push(
            `${where}: app.${r.method}('${r.pattern}', ...) registers the ` +
              `framework-reserved path '${r.pattern}'`
          );
        }
      }
      if (errors.length > 0) {
        this.error(
          `[hono-preact] api.ts registers routes that shadow framework handlers:\n` +
            errors.map((e) => `  - ${e}`).join('\n') +
            `\nThe framework mounts your app ahead of its reserved paths ` +
            `(/__loaders, /__actions) and the SSR handler, so these routes break ` +
            `loaders/actions and/or page rendering. Use specific, non-wildcard paths.`
        );
      }
```

- [ ] **Step 4: Run the full server-entry suite to verify it passes**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck the vite package**

Run: `pnpm --filter '@hono-preact/vite' exec tsc --noEmit`
Expected: exit 0, no errors (confirms no remaining `findApiCatchAllRoutes` / `CatchAllWarning` references).

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts
git commit -m "feat(vite): fail the build on api.ts routes that shadow reserved paths"
```

---

## Task 5: Documentation — `csrf.mdx`

The existing recipe in `apps/site/src/pages/docs/csrf.mdx` (`app.use('/__actions', …)` in `api.ts`) only became *functional* with this change. Add the explanation and the app-wide-middleware note.

**Files:**
- Modify: `apps/site/src/pages/docs/csrf.mdx`

- [ ] **Step 1: Add the mount-order note after the recipe code block**

In `csrf.mdx`, immediately after the recipe code block (the one ending `export default app;`) and before the `### Configure the allowed origin` heading, insert this paragraph:

```mdx
This works because the framework mounts your `api.ts` app **ahead of** its own reserved paths (`/__loaders`, `/__actions`) and the page renderer. Middleware you register in `api.ts` therefore runs before the framework's RPC and SSR handlers — `app.use('/__actions', …)` reaches the actions endpoint, and `app.use('*', …)` is effectively app-wide. The flip side: do not register a catch-all route (`*`, `/*`, `app.on(...)` on `'*'`) or the literal paths `/__loaders` / `/__actions` in `api.ts` — they would shadow the framework's handlers, so the build rejects them.
```

- [ ] **Step 2: Verify the docs site still builds**

Run: `pnpm --filter site exec astro check 2>/dev/null || pnpm exec prettier --check apps/site/src/pages/docs/csrf.mdx`
Expected: the prettier check passes (`astro check` may not be wired; the prettier check is the reliable gate). If prettier reports formatting, run `pnpm exec prettier --write apps/site/src/pages/docs/csrf.mdx`.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/docs/csrf.mdx
git commit -m "docs(csrf): explain reserved-path mount order and the catch-all rule"
```

---

## Task 6: Correct the primitives audit

**Files:**
- Modify: `docs/superpowers/research/2026-05-14-hono-primitives-audit.md`

- [ ] **Step 1: Fix the `hono/csrf` table row**

In `docs/superpowers/research/2026-05-14-hono-primitives-audit.md`, find the `hono/csrf` row's rationale text:

```
| `hono/csrf` | unused | sidestep | **keep** | Users mount `csrf()` on their `c.api` like in any other Hono app. The framework deliberately doesn't pre-decide for them. If a user wants CSRF on `/__actions/*` specifically, they wrap the handler or use middleware composition; framework auto-mounting would violate "use Hono as normal." |
```

Replace it with:

```
| `hono/csrf` | unused | sidestep | **keep** | Users mount `csrf()` on their `c.api` like in any other Hono app. The framework deliberately doesn't pre-decide for them. A user who wants CSRF on `/__actions` specifically registers `app.use('/__actions', …)` in their `api.ts`: #43 mounts the user app ahead of the reserved paths, so that middleware reaches the endpoint. Framework auto-mounting would still violate "use Hono as normal." |
```

- [ ] **Step 2: Annotate recommendation 1**

Find the non-recommendation:

```
- **Do not auto-mount `hono/csrf` on `/__actions`.** Earlier draft proposed this; it violates the guiding principle.
```

Replace it with:

```
- **Do not auto-mount `hono/csrf` on `/__actions`.** Earlier draft proposed this; it violates the guiding principle. Resolved by #43 (`docs/superpowers/specs/2026-05-17-reserved-path-middleware-design.md`): the user app now mounts ahead of the reserved paths, so users compose `csrf()` themselves with no framework auto-mount.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/research/2026-05-14-hono-primitives-audit.md
git commit -m "docs(audit): correct hono/csrf row — #43 resolved reserved-path composition"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run the full Vite package test suite**

Run: `pnpm exec vitest run packages/vite`
Expected: PASS — all files green.

- [ ] **Step 2: Run the full repository test suite**

Run: `pnpm test`
Expected: PASS — no regressions in `packages/server`, `packages/iso`, or `apps/site`.

- [ ] **Step 3: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 4: Prettier check on touched files**

Run: `pnpm exec prettier --check "packages/vite/src/server-entry.ts" "packages/vite/src/__tests__/server-entry.test.ts" "apps/site/src/pages/docs/csrf.mdx"`
Expected: "All matched files use Prettier code style!" — if not, run `prettier --write` on the reported files and amend the relevant commit.

---

## Self-Review

**Spec coverage:**
- Spec part 1 (entry reordering) → Task 1.
- Spec part 2 (shadow detection: severity table, `.on()` fix, rename) → Tasks 3 and 4.
- Spec part 3 (docs) → Task 5.
- Spec part 4 (audit correction) → Task 6.
- Spec "Verification" (Hono mount-order semantics) → Task 2 (composition test) covers cases 1, 3, 5 behaviorally.
- Spec "Testing" (entry order, detection error cases, csrf integration) → Tasks 1, 3, 4, 2.
- Spec acceptance checklist → all five items map to Tasks 1, 3/4, 5, 6, and 7.

**Type consistency:** `ApiShadowingRoute` (Task 3) is consumed by `buildStart` in Task 4 — kinds `wildcard` / `reserved` / `notFound` and the `severity` field match between the type definition, the `walk` pushes, and the `buildStart` switch. `findApiShadowingRoutes` is the single name used in the function definition (Task 3), the test import (Task 3 Step 2), and the `buildStart` caller (Task 4).

**No placeholders:** every step shows exact code or exact commands with expected output.
