import { describe, it, expect } from 'vitest';
import {
  findApiCatchAllRoutes,
  generateServerEntrySource,
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
