import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  GENERATED_SERVER_ENTRY_RELATIVE,
  findApiShadowingRoutes,
  generateServerEntrySource,
  generatedServerEntryAbsPath,
  serverEntryPlugin,
} from '../server-entry.js';

describe('generateServerEntrySource', () => {
  it('emits the framework imports, mounts loaders/actions/catchall, omits api when not provided', () => {
    const src = generateServerEntrySource({
      layoutAbsPath: '/proj/src/Layout.tsx',
      routesAbsPath: '/proj/src/routes.ts',
      apiAbsPath: undefined,
    });

    // Framework imports
    expect(src).toContain(`import { Hono } from 'hono';`);
    expect(src).toContain(`import { Routes, env } from 'hono-preact';`);
    expect(src).toContain(
      `import {\n  actionsHandler,\n  loadersHandler,\n  renderPage,\n  routeServerModules,\n} from 'hono-preact/server';`
    );

    // User imports (absolute paths)
    expect(src).toContain(`import Layout from '/proj/src/Layout.tsx';`);
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);
    expect(src).toContain(`import { LocationProvider } from 'preact-iso';`);

    // No api import when not provided
    expect(src).not.toContain('api.ts');
    expect(src).not.toContain('userApp');

    // The location middleware was removed; locationStub now runs synchronously
    // inside renderPage so concurrent renders cannot race on globalThis.location.
    expect(src).not.toContain('.use(location)');
    expect(src).not.toMatch(/^\s*location,\s*$/m);

    // env.current is set
    expect(src).toContain(`env.current = 'server';`);

    // Handler options thread dev mode through so the cache-vs-rebuild
    // branch doesn't rely on a Vite-only build-time constant inside the
    // library handlers themselves.
    expect(src).toContain(`const handlerOpts = { dev: import.meta.env.DEV };`);
    expect(src).toContain(`loadersHandler(serverModules, handlerOpts)`);
    expect(src).toContain(`actionsHandler(serverModules, handlerOpts)`);

    // Hono pipeline in correct order
    const loadersIdx = src.indexOf(`'/__loaders'`);
    const actionsIdx = src.indexOf(`'/__actions'`);
    const catchallIdx = src.indexOf(`.get('*'`);
    expect(loadersIdx).toBeGreaterThan(-1);
    expect(actionsIdx).toBeGreaterThan(loadersIdx);
    expect(catchallIdx).toBeGreaterThan(actionsIdx);
    expect(src).toContain(
      `(c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes }))))`
    );
    // defaultTitle is no longer threaded through renderPage by the framework.
    expect(src).not.toContain('defaultTitle');

    // Default export
    expect(src.trimEnd().endsWith('export default app;')).toBe(true);

    // Layout vnode constructed with h() (not JSX) so the virtual module
    // compiles without a TSX loader hint.
    expect(src).toContain(`import { h } from 'preact';`);
    expect(src).not.toContain('<Layout');
  });

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
});

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

  it('flags an app.on() registration of a reserved path (path is the second argument)', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().on('POST', '/__actions', (c) => c.text('mine'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'reserved',
      method: 'on',
      pattern: '/__actions',
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

describe('serverEntryPlugin', () => {
  it('GENERATED_SERVER_ENTRY_RELATIVE is the documented project-relative entry path', () => {
    expect(GENERATED_SERVER_ENTRY_RELATIVE).toBe(
      'node_modules/.vite/hono-preact/server-entry.tsx'
    );
  });

  it('generatedServerEntryAbsPath() resolves against cwd by default', () => {
    const p = generatedServerEntryAbsPath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(p.endsWith(GENERATED_SERVER_ENTRY_RELATIVE)).toBe(true);

    const overridden = generatedServerEntryAbsPath('/some/other/root');
    expect(overridden).toBe(
      path.join('/some/other/root', GENERATED_SERVER_ENTRY_RELATIVE)
    );
  });

  // The disk write happens in buildStart (not configResolved) so config-only
  // Vite invocations (IDE probes, vitest loading the config, dependency
  // optimizer cold runs) don't side-effect the cache directory. These tests
  // drive both lifecycle hooks in order.
  it('buildStart writes the generated entry to outputPath (no api file)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    const outputPath = path.join(
      tmp,
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );

    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts', // configured but does not exist on disk
      outputPath,
    });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({
      root: tmp,
    });
    // configResolved alone should NOT have written anything.
    expect(fs.existsSync(outputPath)).toBe(false);

    const ctx = {
      warn: () => {},
      error: (m: unknown) => {
        throw new Error(typeof m === 'string' ? m : String(m));
      },
    };
    (plugin as { buildStart?: (this: typeof ctx) => void }).buildStart?.call(
      ctx
    );

    expect(fs.existsSync(outputPath)).toBe(true);
    const code = fs.readFileSync(outputPath, 'utf8');
    expect(code).toContain(
      `import Layout from '${path.join(tmp, 'src', 'Layout.tsx')}';`
    );
    expect(code).toContain(
      `import routes from '${path.join(tmp, 'src', 'routes.ts')}';`
    );
    // Configured api path that doesn't exist is treated as absent.
    expect(code).not.toContain('api.ts');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildStart writes an entry that includes api when the file exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nexport default new Hono().get('/api/x', (c) => c.text('ok'));\n`
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
    ).configResolved?.({
      root: tmp,
    });
    const ctx = {
      warn: () => {},
      error: (m: unknown) => {
        throw new Error(typeof m === 'string' ? m : String(m));
      },
    };
    (plugin as { buildStart?: (this: typeof ctx) => void }).buildStart?.call(
      ctx
    );

    const code = fs.readFileSync(outputPath, 'utf8');
    expect(code).toContain(
      `import userApp from '${path.join(tmp, 'src', 'api.ts')}';`
    );
    expect(code).toContain(`.route('/', userApp)`);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

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
});

describe('mount-order composition (why api.ts is mounted first)', () => {
  it('middleware in the user app guards the reserved /__actions path', async () => {
    const { Hono } = await import('hono');
    const { csrf } = await import('hono/csrf');

    let actionRan = false;
    const userApp = new Hono();
    userApp.use('*', csrf({ origin: 'https://example.com' }));

    // Mirrors the order generateServerEntrySource emits: userApp first.
    const app = new Hono().route('/', userApp).post('/__actions', (c) => {
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
