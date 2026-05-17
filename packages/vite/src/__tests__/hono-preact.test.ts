import { describe, it, expect } from 'vitest';
import { honoPreact } from '../hono-preact.js';

function findConfigPlugin(plugins: ReturnType<typeof honoPreact>) {
  const configPlugin = plugins.find(
    (p) => 'config' in p && typeof p.config === 'function'
  );
  if (!configPlugin || typeof configPlugin.config !== 'function') {
    throw new Error('config plugin not found');
  }
  return configPlugin.config as (config: unknown, env: unknown) => unknown;
}

function getClientConfig(plugins: ReturnType<typeof honoPreact>, userConfig = {}) {
  return findConfigPlugin(plugins)(userConfig, {
    mode: 'client',
    command: 'build',
  });
}

function getServerConfig(plugins: ReturnType<typeof honoPreact>, userConfig = {}) {
  return findConfigPlugin(plugins)(userConfig, {
    mode: 'production',
    command: 'build',
  });
}

describe('honoPreact rollupOptions merge', () => {
  it('uses framework defaults when no clientBuild.rollupOptions provided', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    const config = getClientConfig(plugins);
    expect(config).toBeTruthy();
    const rollup = (config as { build: { rollupOptions: { input: string[]; output: { entryFileNames: string } } } }).build.rollupOptions;
    expect(rollup.input).toEqual(['virtual:hono-preact/client']);
    expect(rollup.output.entryFileNames).toBe('static/client.js');
  });

  it('merges user output fields without losing framework defaults', () => {
    const plugins = honoPreact({
      entry: './src/server.tsx',
      clientBuild: {
        rollupOptions: {
          output: { entryFileNames: 'custom/entry.js' },
        },
      },
    });
    const config = getClientConfig(plugins);
    const rollup = (config as { build: { rollupOptions: { output: { entryFileNames: string; chunkFileNames: string } } } }).build.rollupOptions;
    expect(rollup.output.entryFileNames).toBe('custom/entry.js');
    expect(rollup.output.chunkFileNames).toBe('static/[name]-[hash].js');
  });

  it('ignores array-form output and keeps framework defaults', () => {
    const plugins = honoPreact({
      entry: './src/server.tsx',
      clientBuild: {
        rollupOptions: {
          output: [{ entryFileNames: 'ignored.js' }],
        },
      },
    });
    const config = getClientConfig(plugins);
    const rollup = (config as { build: { rollupOptions: { output: { entryFileNames: string } } } }).build.rollupOptions;
    expect(rollup.output.entryFileNames).toBe('static/client.js');
  });
});

describe('honoPreact server build config', () => {
  type ServerCfg = {
    ssr: { noExternal: string[] };
    build: Record<string, unknown> & { target: string; assetsDir: string };
  };

  it('declares the framework SSR noExternal list', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    const config = getServerConfig(plugins) as ServerCfg;
    expect(config.ssr.noExternal).toEqual([
      'preact-render-to-string',
      'preact-iso',
      'hono-preact',
      '@hono-preact/iso',
      '@hono-preact/server',
    ]);
  });

  it('preserves shared build defaults on the server config', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    const config = getServerConfig(plugins) as ServerCfg;
    expect(config.build.target).toBe('esnext');
    expect(config.build.assetsDir).toBe('static');
    expect(config.build.ssrEmitAssets).toBe(true);
  });

  it('merges user serverBuild fields over framework defaults', () => {
    const plugins = honoPreact({
      entry: './src/server.tsx',
      serverBuild: { outDir: 'custom-server-out', minify: false },
    });
    const config = getServerConfig(plugins) as ServerCfg;
    expect(config.build.outDir).toBe('custom-server-out');
    expect(config.build.minify).toBe(false);
    // Shared defaults survive what the user didn't override.
    expect(config.build.assetsDir).toBe('static');
  });

  it('uses inline sourcemaps on server so SSR stacks point at user source', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    const config = getServerConfig(plugins) as ServerCfg & {
      build: { sourcemap?: unknown };
    };
    // The Worker bundle inlines sourcemaps because Workers tooling won't
    // follow a sibling .map file. See hono-preact.ts for the rationale.
    expect(config.build.sourcemap).toBe('inline');
  });

  it('does not include client-only build fields (cssCodeSplit, rollupOptions)', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    const config = getServerConfig(plugins) as ServerCfg & {
      build: { cssCodeSplit?: unknown; rollupOptions?: unknown };
    };
    expect(config.build.cssCodeSplit).toBeUndefined();
    expect(config.build.rollupOptions).toBeUndefined();
  });

  it('lets serverBuild.sourcemap override the inline default (e.g. false to disable)', () => {
    const plugins = honoPreact({
      entry: './src/server.tsx',
      serverBuild: { sourcemap: false },
    });
    const config = getServerConfig(plugins) as ServerCfg & {
      build: { sourcemap?: unknown };
    };
    expect(config.build.sourcemap).toBe(false);
  });

  it('honors sharedBuild on both client and server configs', () => {
    const plugins = honoPreact({
      entry: './src/server.tsx',
      sharedBuild: { reportCompressedSize: false },
    });
    const client = getClientConfig(plugins) as { build: { reportCompressedSize?: boolean } };
    const server = getServerConfig(plugins) as { build: { reportCompressedSize?: boolean } };
    expect(client.build.reportCompressedSize).toBe(false);
    expect(server.build.reportCompressedSize).toBe(false);
  });
});

describe('honoPreact plugin assembly', () => {
  type NamedPlugin = { name?: string; apply?: unknown };

  it('emits the framework plugins in the documented pipeline order', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' }) as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    // The first six entries are the framework plugins; the remaining are
    // upstream plugin instances (vite-build, vite-dev-server) whose names
    // we don't lock to keep this test resilient to upstream renames.
    expect(names.slice(0, 6)).toEqual([
      'hono-preact:config',
      'hono-preact:client-shim',
      'hono-preact:client-entry',
      'server-loader-validation',
      'module-key',
      'server-only',
    ]);
  });

  it('emits at least eight framework-owned plugins when entry is provided', () => {
    // 8 framework plugins (config, client-shim, client-entry, validation,
    // module-key, server-only, build, dev-server) plus an unknown number of
    // preact preset plugins.
    const plugins = honoPreact({ entry: './src/server.tsx' });
    expect(plugins.length).toBeGreaterThanOrEqual(8);
  });

  it('adds exactly one more framework-owned plugin in the zero-arg path (server-entry)', () => {
    const withEntry = honoPreact({ entry: './src/server.tsx' });
    const zeroArg = honoPreact();
    expect(zeroArg.length).toBe(withEntry.length + 1);
  });

  it('emits the documented pipeline order in the zero-arg path', () => {
    const plugins = honoPreact() as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    // client-entry slots in after client-shim; server-entry slots in after
    // client-entry, before validation/module-key/server-only.
    expect(names.slice(0, 7)).toEqual([
      'hono-preact:config',
      'hono-preact:client-shim',
      'hono-preact:client-entry',
      'hono-preact:server-entry',
      'server-loader-validation',
      'module-key',
      'server-only',
    ]);
  });

  it('gates the build plugin to non-client build commands', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' }) as NamedPlugin[];
    const buildPlugin = plugins[7];
    expect(typeof buildPlugin.apply).toBe('function');
    const apply = buildPlugin.apply as (
      _: unknown,
      env: { command: string; mode: string }
    ) => boolean;
    expect(apply({}, { command: 'build', mode: 'production' })).toBe(true);
    expect(apply({}, { command: 'build', mode: 'client' })).toBe(false);
    expect(apply({}, { command: 'serve', mode: 'production' })).toBe(false);
  });

  it('gates the dev-server plugin to serve only', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' }) as NamedPlugin[];
    const devPlugin = plugins[8];
    expect(devPlugin.apply).toBe('serve');
  });
});

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

describe('honoPreact client-entry wiring', () => {
  type NamedPlugin = { name?: string };

  it('includes the client-entry plugin', () => {
    const plugins = honoPreact() as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    expect(names).toContain('hono-preact:client-entry');
  });

  it('defaults the client build input to the virtual client entry', () => {
    const plugins = honoPreact();
    const config = getClientConfig(plugins) as {
      build: { rollupOptions: { input: string[] } };
    };
    expect(config.build.rollupOptions.input).toEqual(['virtual:hono-preact/client']);
  });

  it('honors a user-provided clientEntry override', () => {
    const plugins = honoPreact({ clientEntry: './src/custom-client.tsx' });
    const config = getClientConfig(plugins) as {
      build: { rollupOptions: { input: string[] } };
    };
    expect(config.build.rollupOptions.input).toEqual(['./src/custom-client.tsx']);
  });
});
