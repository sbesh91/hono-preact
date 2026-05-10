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
    expect(rollup.input).toEqual(['./src/client.tsx']);
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

  it('does not include client-only build fields (sourcemap, cssCodeSplit)', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    const config = getServerConfig(plugins) as ServerCfg & {
      build: { sourcemap?: unknown; cssCodeSplit?: unknown; rollupOptions?: unknown };
    };
    expect(config.build.sourcemap).toBeUndefined();
    expect(config.build.cssCodeSplit).toBeUndefined();
    expect(config.build.rollupOptions).toBeUndefined();
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
    // The first five entries are the framework plugins; the remaining are
    // upstream plugin instances (vite-build, vite-dev-server) whose names
    // we don't lock to keep this test resilient to upstream renames.
    expect(names.slice(0, 5)).toEqual([
      'hono-preact:config',
      'hono-preact:client-shim',
      'server-loader-validation',
      'module-key',
      'server-only',
    ]);
  });

  it('emits exactly seven plugins (config, four transforms, build, dev-server)', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    expect(plugins).toHaveLength(7);
  });

  it('gates the build plugin to non-client build commands', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' }) as NamedPlugin[];
    const buildPlugin = plugins[5];
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
    const devPlugin = plugins[6];
    expect(devPlugin.apply).toBe('serve');
  });
});
