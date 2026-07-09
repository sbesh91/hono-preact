import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { honoPreact } from '../hono-preact.js';
import type { HonoPreactAdapter } from '../adapter.js';

function fakeAdapter(): HonoPreactAdapter {
  return {
    name: 'fake',
    vitePlugins: () => [{ name: 'fake-adapter:plugin' }],
    wrapEntry: (c) =>
      `export { default } from ${JSON.stringify(c.coreAppModuleId)};\n`,
  };
}

type NamedPlugin = { name?: string };

describe('honoPreact adapter requirement', () => {
  it('throws when called without an adapter', () => {
    // @ts-expect-error - exercising the runtime guard
    expect(() => honoPreact({})).toThrow(/adapter/i);
  });

  it('throws when called with no options at all', () => {
    // @ts-expect-error - exercising the runtime guard
    expect(() => honoPreact()).toThrow(/adapter/i);
  });
});

describe('honoPreact plugin assembly', () => {
  it('emits the framework plugins in pipeline order, then the adapter plugins, then preact', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() }) as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    expect(names.slice(0, 10)).toEqual([
      'hono-preact:config',
      'hono-preact:client-shim',
      'hono-preact:client-entry',
      'hono-preact:preload-manifest',
      'hono-preact:server-entry',
      'server-loader-validation',
      'module-key',
      // Runs before server-only so the injected `.server` import is present
      // when server-only rewrites it to a client stub.
      'route-server-autodiscovery',
      'server-only',
      'hono-preact:guard-strip',
    ]);
  });

  it('splices the adapter-contributed plugins into the chain', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() }) as NamedPlugin[];
    expect(plugins.map((p) => p.name)).toContain('fake-adapter:plugin');
  });

  it('includes the preact preset plugins', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() }) as NamedPlugin[];
    expect(plugins.map((p) => p.name)).toContain('vite:preact-jsx');
  });
});

describe('honoPreact config plugin', () => {
  it('contributes shared config: preact dedupe, esnext target, static assetsDir', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const cfg = plugins.find((p) => p.name === 'hono-preact:config');
    if (!cfg || typeof cfg.config !== 'function') {
      throw new Error('config plugin not found');
    }
    const result = cfg.config({}, { command: 'build', mode: 'production' }) as {
      resolve: { dedupe: string[] };
      build: { target: string; assetsDir: string };
    };
    expect(result.resolve.dedupe).toContain('preact');
    expect(result.resolve.dedupe).toContain('preact-iso');
    expect(result.resolve.dedupe).not.toContain('preact/compat');
    expect(result.build.target).toBe('esnext');
    expect(result.build.assetsDir).toBe('static');
  });

  it('does not branch on mode (no client-only rollupOptions)', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const cfg = plugins.find((p) => p.name === 'hono-preact:config');
    const a = (cfg!.config as Function)(
      {},
      { command: 'build', mode: 'client' }
    );
    const b = (cfg!.config as Function)(
      {},
      { command: 'build', mode: 'production' }
    );
    expect(a).toEqual(b);
  });

  it('configures the client build environment input to the client entry', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const cfg = plugins.find((p) => p.name === 'hono-preact:config');
    const result = (cfg!.config as Function)(
      {},
      { command: 'build', mode: 'production' }
    ) as {
      environments: {
        client: {
          build: {
            rollupOptions: {
              input: string[];
              output: { entryFileNames: string; chunkFileNames: string };
            };
          };
        };
      };
    };
    const ro = result.environments.client.build.rollupOptions;
    expect(ro.input).toEqual(['virtual:hono-preact/client']);
    expect(ro.output.entryFileNames).toBe('static/client.js');
    expect(ro.output.chunkFileNames).toBe('static/[name]-[hash].js');
  });

  it('seeds non-client environments with the routes manifest as an optimizeDeps scan entry', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const cfg = plugins.find((p) => p.name === 'hono-preact:config');
    if (!cfg || typeof cfg.configEnvironment !== 'function') {
      throw new Error('config plugin has no configEnvironment hook');
    }
    const expected = resolve(process.cwd(), 'src/routes.ts');

    // The worker/SSR environment (any non-client name) gets the scan entry.
    const ssr = cfg.configEnvironment(
      'ssr',
      {},
      {
        command: 'serve',
        mode: 'development',
      }
    );
    expect(ssr).toEqual({ optimizeDeps: { entries: [expected] } });

    const worker = cfg.configEnvironment(
      'hono_preact',
      {},
      {
        command: 'serve',
        mode: 'development',
      }
    );
    expect(worker).toEqual({ optimizeDeps: { entries: [expected] } });
  });

  it('does not seed the client environment (no SSR prerender there)', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const cfg = plugins.find((p) => p.name === 'hono-preact:config');
    if (!cfg || typeof cfg.configEnvironment !== 'function') {
      throw new Error('config plugin has no configEnvironment hook');
    }
    const client = cfg.configEnvironment(
      'client',
      {},
      {
        command: 'serve',
        mode: 'development',
      }
    );
    expect(client).toBeUndefined();
  });

  it('honors a custom routes path in the scan entry', () => {
    const plugins = honoPreact({
      adapter: fakeAdapter(),
      routes: 'app/routing.ts',
    });
    const cfg = plugins.find((p) => p.name === 'hono-preact:config');
    if (!cfg || typeof cfg.configEnvironment !== 'function') {
      throw new Error('config plugin has no configEnvironment hook');
    }
    const ssr = cfg.configEnvironment(
      'ssr',
      {},
      {
        command: 'serve',
        mode: 'development',
      }
    );
    expect(ssr).toEqual({
      optimizeDeps: { entries: [resolve(process.cwd(), 'app/routing.ts')] },
    });
  });

  it('resolves the optimizer scan entry against a custom Vite root, not cwd', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const cfg = plugins.find((p) => p.name === 'hono-preact:config');
    if (
      !cfg ||
      typeof cfg.config !== 'function' ||
      typeof cfg.configEnvironment !== 'function'
    ) {
      throw new Error('config plugin hooks not found');
    }
    // Vite runs every plugin's `config` before any `configEnvironment`.
    (cfg.config as Function)(
      { root: '/custom/app' },
      { command: 'serve', mode: 'development' }
    );
    const ssr = cfg.configEnvironment(
      'ssr',
      {},
      { command: 'serve', mode: 'development' }
    );
    expect(ssr).toEqual({
      optimizeDeps: { entries: [resolve('/custom/app', 'src/routes.ts')] },
    });
  });
});
