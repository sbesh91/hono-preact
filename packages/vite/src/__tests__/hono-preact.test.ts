import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  rolldownVersion,
  rollupVersion,
  version as viteVersion,
  type ConfigEnv,
  type ConfigPluginContext,
  type EnvironmentOptions,
  type Plugin,
  type UserConfig,
} from 'vite';
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

/**
 * A minimal but real `ConfigPluginContext`. Vite declares `this:
 * ConfigPluginContext` on the `config` and `configEnvironment` hooks, so a
 * bare `plugin.config(...)` call passes the plugin object as `this` -- wrong at
 * runtime and a type error besides. These hooks never touch the context, so the
 * log methods are no-ops; `error` throws so a hook that unexpectedly reaches for
 * it fails loudly instead of returning a bogus value.
 */
function configPluginContext(): ConfigPluginContext {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (e) => {
      throw typeof e === 'string' ? new Error(e) : e;
    },
    meta: { rollupVersion, rolldownVersion, viteVersion },
  };
}

function findPlugin(plugins: Plugin[], name: string): Plugin {
  const plugin = plugins.find((p) => p.name === name);
  if (!plugin) throw new Error(`plugin not found: ${name}`);
  return plugin;
}

/** Invoke a plugin's `config` hook with a proper context and assert it
 * produced a config object (the hooks under test are synchronous). */
async function callConfig(
  plugin: Plugin,
  userConfig: UserConfig,
  env: ConfigEnv
): Promise<Omit<UserConfig, 'plugins'>> {
  const hook = plugin.config;
  if (typeof hook !== 'function') {
    throw new Error(`${plugin.name} has no config hook`);
  }
  const result = await hook.call(configPluginContext(), userConfig, env);
  if (!result) {
    throw new Error(`${plugin.name} config hook returned no config`);
  }
  return result;
}

/** Invoke a plugin's `configEnvironment` hook with a proper context. Returns
 * whatever the hook returned, including the "no opinion" empty result. */
async function callConfigEnvironment(
  plugin: Plugin,
  name: string,
  env: ConfigEnv
): Promise<EnvironmentOptions | null | void> {
  const hook = plugin.configEnvironment;
  if (typeof hook !== 'function') {
    throw new Error(`${plugin.name} has no configEnvironment hook`);
  }
  return await hook.call(configPluginContext(), name, {}, env);
}

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

// css.global's exists+isFile validation now lives in clientEntryPlugin's
// configResolved (resolved against config.root, not process.cwd()); see
// packages/vite/src/__tests__/client-entry.test.ts's "clientEntryPlugin
// css.global validation" describe block. honoPreact() itself no longer
// validates cssGlobal synchronously, since configResolved only runs once
// Vite resolves the config.

describe('honoPreact plugin assembly', () => {
  it('emits the framework plugins in pipeline order, then the adapter plugins, then preact', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const names = plugins.map((p) => p.name);
    expect(names.slice(0, 11)).toEqual([
      'hono-preact:config',
      'hono-preact:client-shim',
      'hono-preact:client-entry',
      'hono-preact:client-entry-contract',
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
    const plugins = honoPreact({ adapter: fakeAdapter() });
    expect(plugins.map((p) => p.name)).toContain('fake-adapter:plugin');
  });

  it('includes the preact preset plugins', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    expect(plugins.map((p) => p.name)).toContain('vite:preact-jsx');
  });
});

describe('honoPreact config plugin', () => {
  it('contributes shared config: preact dedupe, esnext target, static assetsDir', async () => {
    const cfg = findPlugin(
      honoPreact({ adapter: fakeAdapter() }),
      'hono-preact:config'
    );
    const result = await callConfig(
      cfg,
      {},
      { command: 'build', mode: 'production' }
    );
    expect(result.resolve?.dedupe).toContain('preact');
    expect(result.resolve?.dedupe).toContain('preact-iso');
    expect(result.resolve?.dedupe).not.toContain('preact/compat');
    expect(result.build?.target).toBe('esnext');
    expect(result.build?.assetsDir).toBe('static');
  });

  it('does not branch on mode (no client-only rollupOptions)', async () => {
    const cfg = findPlugin(
      honoPreact({ adapter: fakeAdapter() }),
      'hono-preact:config'
    );
    const a = await callConfig(cfg, {}, { command: 'build', mode: 'client' });
    const b = await callConfig(
      cfg,
      {},
      { command: 'build', mode: 'production' }
    );
    expect(a).toEqual(b);
  });

  it('configures the client build environment input to the client entry', async () => {
    const cfg = findPlugin(
      honoPreact({ adapter: fakeAdapter() }),
      'hono-preact:config'
    );
    const result = await callConfig(
      cfg,
      {},
      { command: 'build', mode: 'production' }
    );
    const ro = result.environments?.client?.build?.rollupOptions;
    expect(ro?.input).toEqual(['virtual:hono-preact/client']);
    // The framework declares a single output config, never an array.
    const output = Array.isArray(ro?.output) ? ro.output[0] : ro?.output;
    expect(output?.entryFileNames).toBe('static/client.js');
    expect(output?.chunkFileNames).toBe('static/[name]-[hash].js');
  });

  it('seeds non-client environments with the routes manifest as an optimizeDeps scan entry', async () => {
    const cfg = findPlugin(
      honoPreact({ adapter: fakeAdapter() }),
      'hono-preact:config'
    );
    const expected = resolve(process.cwd(), 'src/routes.ts');
    const env: ConfigEnv = { command: 'serve', mode: 'development' };

    // The worker/SSR environment (any non-client name) gets the scan entry.
    const ssr = await callConfigEnvironment(cfg, 'ssr', env);
    expect(ssr).toEqual({ optimizeDeps: { entries: [expected] } });

    const worker = await callConfigEnvironment(cfg, 'hono_preact', env);
    expect(worker).toEqual({ optimizeDeps: { entries: [expected] } });
  });

  it('does not seed the client environment (no SSR prerender there)', async () => {
    const cfg = findPlugin(
      honoPreact({ adapter: fakeAdapter() }),
      'hono-preact:config'
    );
    const client = await callConfigEnvironment(cfg, 'client', {
      command: 'serve',
      mode: 'development',
    });
    expect(client).toBeUndefined();
  });

  it('honors a custom routes path in the scan entry', async () => {
    const cfg = findPlugin(
      honoPreact({ adapter: fakeAdapter(), routes: 'app/routing.ts' }),
      'hono-preact:config'
    );
    const ssr = await callConfigEnvironment(cfg, 'ssr', {
      command: 'serve',
      mode: 'development',
    });
    expect(ssr).toEqual({
      optimizeDeps: { entries: [resolve(process.cwd(), 'app/routing.ts')] },
    });
  });

  it('resolves the optimizer scan entry against a custom Vite root, not cwd', async () => {
    const cfg = findPlugin(
      honoPreact({ adapter: fakeAdapter() }),
      'hono-preact:config'
    );
    const env: ConfigEnv = { command: 'serve', mode: 'development' };
    // Vite runs every plugin's `config` before any `configEnvironment`.
    await callConfig(cfg, { root: '/custom/app' }, env);
    const ssr = await callConfigEnvironment(cfg, 'ssr', env);
    expect(ssr).toEqual({
      optimizeDeps: { entries: [resolve('/custom/app', 'src/routes.ts')] },
    });
  });
});
