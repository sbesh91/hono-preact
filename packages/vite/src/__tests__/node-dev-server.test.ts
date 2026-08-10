import { describe, it, expect, vi } from 'vitest';
import {
  nodeBuildPlugin,
  nodeDevServerPlugin,
  shouldForceSsr,
  type NodeDevServerOptions,
} from '../node-dev-server.js';

// createServerModuleRunner needs a real Vite dev server internals (HMR
// channel, etc.) that a plain stub can't satisfy. The caller test below only
// needs the middleware's routing decision, not a working module runner, so
// stub it out while keeping the real nodeDevServerPlugin under test.
vi.mock('vite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vite')>();
  return {
    ...actual,
    createServerModuleRunner: () => ({
      import: async () => ({
        default: { fetch: async () => new Response('ok') },
      }),
    }),
  };
});

const ctx = {
  root: '/p',
  coreAppModuleId: '/p/node_modules/.vite/hono-preact/core-app.tsx',
  entryWrapperId: '/p/node_modules/.vite/hono-preact/server-entry.tsx',
};

describe('nodeBuildPlugin', () => {
  it('configures client and ssr build environments', () => {
    const plugin = nodeBuildPlugin(ctx);
    const cfg = (plugin.config as Function)(
      {},
      { command: 'build', mode: 'production' }
    ) as {
      environments: {
        client: { build: { outDir: string } };
        ssr: {
          build: {
            outDir: string;
            ssr: boolean;
            rollupOptions: { input: string[] };
          };
        };
      };
    };
    expect(cfg.environments.client.build.outDir).toBe('dist/client');
    expect(cfg.environments.ssr.build.outDir).toBe('dist/server');
    expect(cfg.environments.ssr.build.ssr).toBe(true);
    expect(cfg.environments.ssr.build.rollupOptions.input).toEqual([
      ctx.entryWrapperId,
    ]);
  });

  it('builds the app via a builder.buildApp orchestrator', () => {
    const plugin = nodeBuildPlugin(ctx);
    const cfg = (plugin.config as Function)(
      {},
      { command: 'build', mode: 'production' }
    ) as { builder: { buildApp: unknown } };
    expect(typeof cfg.builder.buildApp).toBe('function');
  });
});

describe('nodeDevServerPlugin', () => {
  it('is a serve-only plugin with a configureServer hook', () => {
    const plugin = nodeDevServerPlugin({
      root: '/p',
      coreAppModuleId: '/p/a.tsx',
      entryWrapperId: '/p/b.tsx',
    });
    expect(plugin.name).toBe('hono-preact:node-dev-server');
    expect(plugin.apply).toBe('serve');
    expect(typeof plugin.configureServer).toBe('function');
  });
});

describe('shouldForceSsr', () => {
  it('is false with no patterns', () => {
    expect(shouldForceSsr('/@alice', [])).toBe(false);
  });

  it('matches a string pattern by prefix', () => {
    expect(shouldForceSsr('/@alice', ['/@'])).toBe(true);
    expect(shouldForceSsr('/users', ['/@'])).toBe(false);
  });

  it('matches a RegExp pattern', () => {
    expect(shouldForceSsr('/@alice', [/^\/@[a-z]+$/])).toBe(true);
    expect(shouldForceSsr('/@fs/x', [/^\/@[a-z]+$/])).toBe(false);
  });

  // A /g RegExp is stateful under .test(): lastIndex advances, so the same
  // pattern would match on one request and miss on the next. The plugin
  // normalizes g and y off, so a user pattern cannot make routing flaky.
  it('is not made stateful by a global-flag RegExp', () => {
    const patterns = [/\/@[a-z]+/g];
    expect(shouldForceSsr('/@alice', patterns)).toBe(
      shouldForceSsr('/@alice', patterns)
    );
  });
});

/**
 * Drive the real middleware the plugin registers. `configureServer` is called
 * with a stub server whose `middlewares.use` captures the handler, and whose
 * `environments.ssr` is enough for createServerModuleRunner not to throw.
 */
async function captureSsrMiddleware(options?: NodeDevServerOptions) {
  let handler:
    | ((
        req: { url?: string; headers?: Record<string, string> },
        res: unknown,
        next: () => void
      ) => Promise<void>)
    | undefined;
  const plugin = nodeDevServerPlugin(ctx, options);
  await (plugin.configureServer as (server: unknown) => void | Promise<void>)({
    environments: { ssr: { hot: { on() {} }, topLevelConfig: {} } },
    httpServer: { on() {} },
    middlewares: {
      use(fn: typeof handler) {
        handler ??= fn;
      },
    },
  });
  if (!handler) throw new Error('no middleware registered');
  return handler;
}

describe('nodeDevServerPlugin dev pass-through', () => {
  it('passes Vite-internal paths through by default', async () => {
    const handler = await captureSsrMiddleware();
    let nexted = false;
    await handler({ url: '/@vite/client' }, {}, () => (nexted = true));
    expect(nexted).toBe(true);
  });

  it('forces a devSsrInclude path to SSR instead of passing it through', async () => {
    const handler = await captureSsrMiddleware({ devSsrInclude: ['/@alice'] });
    let nexted = false;
    // The stubbed module runner (mocked above) serves a real Response, so a
    // successful SSR render (not a caught error) is the proof this request
    // did NOT take the pass-through branch: `next` is never called at all.
    await handler(
      { url: '/@alice?tab=posts', headers: {} },
      { setHeader() {}, write() {}, end() {} },
      () => (nexted = true)
    ).catch(() => {});
    expect(nexted).toBe(false);
  });

  it('still passes /@vite/client through even with a broad devSsrInclude pattern', async () => {
    const handler = await captureSsrMiddleware({ devSsrInclude: ['/@'] });
    let nexted = false;
    await handler({ url: '/@vite/client' }, {}, () => (nexted = true));
    expect(nexted).toBe(true);
  });

  it('still forces a genuine app route to SSR under that same broad pattern', async () => {
    const handler = await captureSsrMiddleware({ devSsrInclude: ['/@'] });
    let nexted = false;
    await handler(
      { url: '/@alice', headers: {} },
      { setHeader() {}, write() {}, end() {} },
      () => (nexted = true)
    ).catch(() => {});
    expect(nexted).toBe(false);
  });
});
