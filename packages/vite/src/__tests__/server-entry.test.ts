import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  findApiCatchAllRoutes,
  generateServerEntrySource,
  serverEntryPlugin,
  VIRTUAL_SERVER_ENTRY_ID,
} from '../server-entry.js';

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
});

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
