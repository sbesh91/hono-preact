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
