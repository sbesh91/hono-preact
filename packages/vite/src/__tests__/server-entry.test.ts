import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  GENERATED_SERVER_ENTRY_RELATIVE,
  findApiCatchAllRoutes,
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
    expect(src).toContain(`import { Routes, env } from '@hono-preact/iso';`);
    expect(src).toContain(
      `import {\n  actionsHandler,\n  loadersHandler,\n  renderPage,\n  routeServerModules,\n} from '@hono-preact/server';`
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
});

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

  it('does not flag c.notFound() inside a handler body', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().get('/api/x/:id', (c) => {
        const id = Number(c.req.param('id'));
        if (!Number.isFinite(id)) return c.notFound();
        return c.text('ok');
      });
    `;
    expect(findApiCatchAllRoutes(src)).toEqual([]);
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

  it('configResolved writes the generated entry to outputPath (no api file)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    const outputPath = path.join(tmp, '.vite', 'hono-preact', 'server-entry.tsx');

    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts', // configured but does not exist on disk
      outputPath,
    });
    (plugin as { configResolved?: (c: { root: string }) => void }).configResolved?.({
      root: tmp,
    });

    expect(fs.existsSync(outputPath)).toBe(true);
    const code = fs.readFileSync(outputPath, 'utf8');
    expect(code).toContain(`import Layout from '${path.join(tmp, 'src', 'Layout.tsx')}';`);
    expect(code).toContain(`import routes from '${path.join(tmp, 'src', 'routes.ts')}';`);
    // Configured api path that doesn't exist is treated as absent.
    expect(code).not.toContain('api.ts');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('configResolved writes an entry that includes api when the file exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nexport default new Hono().get('/api/x', (c) => c.text('ok'));\n`
    );
    const outputPath = path.join(tmp, '.vite', 'hono-preact', 'server-entry.tsx');

    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      outputPath,
    });
    (plugin as { configResolved?: (c: { root: string }) => void }).configResolved?.({
      root: tmp,
    });

    const code = fs.readFileSync(outputPath, 'utf8');
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
    const outputPath = path.join(tmp, '.vite', 'hono-preact', 'server-entry.tsx');

    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      outputPath,
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
