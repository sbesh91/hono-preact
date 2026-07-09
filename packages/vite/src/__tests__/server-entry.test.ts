import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  GENERATED_CORE_APP_RELATIVE,
  GENERATED_ENTRY_WRAPPER_RELATIVE,
  findApiShadowingRoutes,
  generateCoreAppModule,
  generatedCoreAppAbsPath,
  generatedEntryWrapperAbsPath,
  serverEntryPlugin,
} from '../server-entry.js';

// Minimal adapter stub for plugin tests that only check file-writing behavior.
const stubAdapter = {
  name: 'stub',
  vitePlugins: () => [],
  wrapEntry: ({
    coreAppModuleId,
  }: {
    root: string;
    coreAppModuleId: string;
    entryWrapperId: string;
  }) => `// stub wrapper\nexport { default } from '${coreAppModuleId}';\n`,
};

describe('generateCoreAppModule', () => {
  it('emits a createServerEntry shim with a default export', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
    });
    expect(src).toContain(
      `import { createServerEntry } from 'hono-preact/server/internal/runtime';`
    );
    expect(src).toContain('createServerEntry({');
    expect(src).toContain('export default app;');
  });

  it('imports Layout and routes by absolute path', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/proj/src/Layout.tsx',
      routesAbsPath: '/proj/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
    });
    expect(src).toContain(`import Layout from '/proj/src/Layout.tsx';`);
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);
    expect(src).toContain('routes,');
    expect(src).toContain('layout: Layout,');
    expect(src).toContain('dev: import.meta.env.DEV,');
  });

  it('re-exports serverImports (routes + registry) for the Cloudflare DO room registry', () => {
    // The Cloudflare worker entry installs the room registry inside the Durable
    // Object isolate from this re-exported lazy-loader array; it must include
    // both route-attached and src/server rooms.
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
      serverRegistryGlob: undefined,
    });
    expect(src).toContain(
      'export const serverImports = [...routes.serverImports, ...serverRegistry];'
    );
  });

  it('emits an empty registry when serverRegistryGlob is undefined', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
      serverRegistryGlob: undefined,
    });
    expect(src).toContain('const serverRegistry = [];');
    expect(src).not.toContain('import.meta.glob');
    expect(src).toContain('serverRegistry,');
  });

  it('globs the server registry folder when serverRegistryGlob is set', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
      serverRegistryGlob: '/src/server/**/*.server.{ts,tsx,js,jsx}',
    });
    expect(src).toContain(
      `const serverRegistry = Object.values(import.meta.glob("/src/server/**/*.server.{ts,tsx,js,jsx}"));`
    );
    expect(src).toContain('serverRegistry,');
  });

  it('passes the user api app via the api option when present', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: '/p/src/api.ts',
      appConfigAbsPath: undefined,
    });
    expect(src).toContain(`import userApp from '/p/src/api.ts';`);
    expect(src).toContain('api: userApp,');
  });

  it('omits the api import and option when no api file exists', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
    });
    expect(src).not.toContain('api.ts');
    expect(src).not.toContain('userApp');
    expect(src).not.toContain('api:');
  });

  it('imports the user appConfig when the file exists', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: '/p/src/app-config.ts',
    });
    expect(src).toContain(`import appConfig from '/p/src/app-config.ts';`);
    expect(src).not.toContain('const appConfig = { use: [] };');
    expect(src).toContain('appConfig,');
  });

  it('falls back to an inline empty appConfig when no file exists', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
    });
    expect(src).not.toContain('app-config');
    expect(src).toContain('const appConfig = { use: [] };');
    expect(src).toContain('appConfig,');
  });

  it('installs the dev global css url when provided', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/proj/src/Layout.tsx',
      routesAbsPath: '/proj/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
      devGlobalCssUrl: '/src/styles/root.css',
    });
    expect(src).toContain(
      `import { installDevGlobalCss } from 'hono-preact/server/internal/runtime';`
    );
    expect(src).toContain(`installDevGlobalCss(["/src/styles/root.css"]);`);
  });

  it('emits nothing when dev global css url is absent', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/proj/src/Layout.tsx',
      routesAbsPath: '/proj/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
    });
    expect(src).not.toContain('installDevGlobalCss');
  });
});

describe('generated entry paths', () => {
  it('core app and entry wrapper resolve to distinct files under the vite cache', () => {
    const core = generatedCoreAppAbsPath('/p');
    const wrapper = generatedEntryWrapperAbsPath('/p');
    expect(core).toContain('node_modules/.vite/hono-preact/');
    expect(wrapper).toContain('node_modules/.vite/hono-preact/');
    expect(core).not.toBe(wrapper);
  });

  it('GENERATED_ENTRY_WRAPPER_RELATIVE is the documented project-relative entry path', () => {
    expect(GENERATED_ENTRY_WRAPPER_RELATIVE).toBe(
      'node_modules/.vite/hono-preact/server-entry.tsx'
    );
  });

  it('GENERATED_CORE_APP_RELATIVE is distinct from the entry wrapper', () => {
    expect(GENERATED_CORE_APP_RELATIVE).toBe(
      'node_modules/.vite/hono-preact/core-app.tsx'
    );
    expect(GENERATED_CORE_APP_RELATIVE).not.toBe(
      GENERATED_ENTRY_WRAPPER_RELATIVE
    );
  });

  it('generatedEntryWrapperAbsPath() resolves against cwd by default', () => {
    const p = generatedEntryWrapperAbsPath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(p.endsWith(GENERATED_ENTRY_WRAPPER_RELATIVE)).toBe(true);

    const overridden = generatedEntryWrapperAbsPath('/some/other/root');
    expect(overridden).toBe(
      path.join('/some/other/root', GENERATED_ENTRY_WRAPPER_RELATIVE)
    );
  });

  it('generatedCoreAppAbsPath() resolves against cwd by default', () => {
    const p = generatedCoreAppAbsPath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(p.endsWith(GENERATED_CORE_APP_RELATIVE)).toBe(true);

    const overridden = generatedCoreAppAbsPath('/some/other/root');
    expect(overridden).toBe(
      path.join('/some/other/root', GENERATED_CORE_APP_RELATIVE)
    );
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
      export default new Hono().on('GET', '/__loaders', (c) => c.text('mine'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'reserved',
      method: 'on',
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

describe('serverEntryPlugin', () => {
  // The disk write happens in config (the earliest Vite hook) so the entry
  // wrapper exists before @cloudflare/vite-plugin's own `config` hook does
  // fs.existsSync on wrangler.jsonc `main`. These tests drive config + buildStart.
  it('config writes the core app module and entry wrapper (no api file)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    const coreAppPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'core-app.tsx'
    );
    const entryWrapperPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );

    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts', // configured but does not exist on disk
      appConfig: 'src/app-config.ts',
      serverDir: 'src/server',
      adapter: stubAdapter,
      coreAppPath,
      entryWrapperPath,
    });
    (
      plugin as {
        config?: (c: { root: string }, env: { command: string }) => void;
      }
    ).config?.({ root: tmp }, { command: 'build' });

    expect(fs.existsSync(coreAppPath)).toBe(true);
    expect(fs.existsSync(entryWrapperPath)).toBe(true);
    // The entry wrapper is the adapter's wrapEntry() output, importing the
    // core app module by its absolute path.
    const wrapperCode = fs.readFileSync(entryWrapperPath, 'utf8');
    expect(wrapperCode).toContain(`export { default } from '${coreAppPath}';`);
    const code = fs.readFileSync(coreAppPath, 'utf8');
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

  it('config writes a core app that includes api when the file exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nexport default new Hono().get('/api/x', (c) => c.text('ok'));\n`
    );
    const coreAppPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'core-app.tsx'
    );
    const entryWrapperPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );

    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      appConfig: 'src/app-config.ts',
      serverDir: 'src/server',
      adapter: stubAdapter,
      coreAppPath,
      entryWrapperPath,
    });
    (
      plugin as {
        config?: (c: { root: string }, env: { command: string }) => void;
      }
    ).config?.({ root: tmp }, { command: 'build' });

    const code = fs.readFileSync(coreAppPath, 'utf8');
    expect(code).toContain(
      `import userApp from '${path.join(tmp, 'src', 'api.ts')}';`
    );
    expect(code).toContain('api: userApp,');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildStart throws via this.error for a catch-all route in api.ts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nexport default new Hono().get('*', (c) => c.text('catch'));\n`
    );
    const coreAppPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'core-app.tsx'
    );
    const entryWrapperPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      appConfig: 'src/app-config.ts',
      serverDir: 'src/server',
      adapter: stubAdapter,
      coreAppPath,
      entryWrapperPath,
    });
    (
      plugin as {
        config?: (c: { root: string }, env: { command: string }) => void;
      }
    ).config?.({ root: tmp }, { command: 'build' });

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

  // F4 / F12: when the user authors an app-config.ts but exports the
  // config as a named export (`export const appConfig = ...`) instead of
  // `export default ...`, the generated `import appConfig from '...'`
  // resolves to undefined and the app-level middleware silently never
  // runs. The buildStart diagnostic catches the misuse at build time.
  it('buildStart throws when app-config.ts is present but lacks a default export', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'app-config.ts'),
      [
        "import { defineApp } from '@hono-preact/iso';",
        'export const appConfig = defineApp({ use: [] });',
        '',
      ].join('\n')
    );
    const coreAppPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'core-app.tsx'
    );
    const entryWrapperPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts', // intentionally missing on disk
      appConfig: 'src/app-config.ts',
      serverDir: 'src/server',
      adapter: stubAdapter,
      coreAppPath,
      entryWrapperPath,
    });
    (
      plugin as {
        config?: (c: { root: string }, env: { command: string }) => void;
      }
    ).config?.({ root: tmp }, { command: 'build' });

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
    ).toThrow(/must default-export/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildStart accepts an app-config.ts with a default export', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'app-config.ts'),
      [
        "import { defineApp } from '@hono-preact/iso';",
        'export default defineApp({ use: [] });',
        '',
      ].join('\n')
    );
    const coreAppPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'core-app.tsx'
    );
    const entryWrapperPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts', // intentionally missing on disk
      appConfig: 'src/app-config.ts',
      serverDir: 'src/server',
      adapter: stubAdapter,
      coreAppPath,
      entryWrapperPath,
    });
    (
      plugin as {
        config?: (c: { root: string }, env: { command: string }) => void;
      }
    ).config?.({ root: tmp }, { command: 'build' });

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
    ).not.toThrow();

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildStart does not error when app-config.ts is absent (fall back to inline empty config)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    // No src/app-config.ts written on disk.
    const coreAppPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'core-app.tsx'
    );
    const entryWrapperPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      appConfig: 'src/app-config.ts',
      serverDir: 'src/server',
      adapter: stubAdapter,
      coreAppPath,
      entryWrapperPath,
    });
    (
      plugin as {
        config?: (c: { root: string }, env: { command: string }) => void;
      }
    ).config?.({ root: tmp }, { command: 'build' });

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
    ).not.toThrow();

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildStart warns (does not throw) for app.notFound in api.ts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-server-entry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'api.ts'),
      `import { Hono } from 'hono';\nconst app = new Hono();\napp.notFound((c) => c.text('nope', 404));\nexport default app;\n`
    );
    const coreAppPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'core-app.tsx'
    );
    const entryWrapperPath = path.join(
      tmp,
      'node_modules',
      '.vite',
      'hono-preact',
      'server-entry.tsx'
    );
    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      appConfig: 'src/app-config.ts',
      serverDir: 'src/server',
      adapter: stubAdapter,
      coreAppPath,
      entryWrapperPath,
    });
    (
      plugin as {
        config?: (c: { root: string }, env: { command: string }) => void;
      }
    ).config?.({ root: tmp }, { command: 'build' });

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
  it('middleware in the user app guards the reserved /__loaders path', async () => {
    const { Hono } = await import('hono');
    const { csrf } = await import('hono/csrf');

    let loadersRan = false;
    const userApp = new Hono();
    userApp.use('*', csrf({ origin: 'https://example.com' }));

    // Mirrors the order generateCoreAppModule emits: userApp first.
    const app = new Hono().route('/', userApp).post('/__loaders', (c) => {
      loadersRan = true;
      return c.json({ ok: true });
    });

    // Cross-origin form post: csrf rejects before the loaders handler runs.
    const blocked = await app.request('https://example.com/__loaders', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'x=1',
    });
    expect(blocked.status).toBe(403);
    expect(loadersRan).toBe(false);

    // Same-origin form post: passes csrf, reaches the loaders handler.
    const ok = await app.request('https://example.com/__loaders', {
      method: 'POST',
      headers: {
        Origin: 'https://example.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'x=1',
    });
    expect(ok.status).toBe(200);
    expect(loadersRan).toBe(true);
  });
});
