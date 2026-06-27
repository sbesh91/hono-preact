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
    expect(names.slice(0, 8)).toEqual([
      'hono-preact:config',
      'hono-preact:client-shim',
      'hono-preact:client-entry',
      'hono-preact:server-entry',
      'server-loader-validation',
      'module-key',
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
});
