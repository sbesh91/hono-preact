import { describe, it, expect, vi } from 'vitest';
import {
  nodeBuildPlugin,
  nodeDevServerPlugin,
  shouldForceSsr,
  type NodeDevServerOptions,
} from '../node-dev-server.js';

// The dev middleware distinguishes a Vite-served project file from an
// application route by probing the filesystem. Tests drive that probe through
// this set rather than creating a temp tree.
let existingFiles = new Set<string>();
let existingDirs = new Set<string>();

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    existsSync: (p: string) => existingFiles.has(p) || existingDirs.has(p),
    statSync: (p: string) => {
      if (existingFiles.has(p)) return { isFile: () => true };
      // A directory exists but is not a file, which is the distinction the
      // middleware's `isFile` probe depends on.
      if (existingDirs.has(p)) return { isFile: () => false };
      throw new Error(`ENOENT: ${p}`);
    },
  };
});

// createServerModuleRunner needs real Vite dev server internals (HMR channel,
// etc.) that a plain stub can't satisfy. The caller tests below only need the
// middleware's routing decision, not a working module runner, so stub it out
// while keeping the real nodeDevServerPlugin under test.
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
  assetNames: [],
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
      assetNames: [],
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
async function captureSsrMiddleware(
  options?: NodeDevServerOptions,
  /**
   * Files that "exist" in the project for this run. The middleware probes the
   * filesystem to tell a Vite-served project file from an application route
   * (see `dev-passthrough.ts`); tests set the mocked `fs` answer rather than
   * laying down a temp tree.
   */
  projectFiles: readonly string[] = [],
  /** Directories that exist in the project for this run. */
  projectDirs: readonly string[] = []
) {
  existingFiles = new Set(projectFiles);
  existingDirs = new Set(projectDirs);
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
    config: { root: ctx.root, publicDir: `${ctx.root}/public` },
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

  // Regression: issue #392. The client entry statically imports /src/routes.ts.
  // Handing that request to the SSR app answers it with the SSR document, so
  // the browser rejects the module on strict MIME checking and the entire
  // client graph never executes: no hydration, on every Node-adapter app.
  it('passes an application source module through to Vite', async () => {
    const handler = await captureSsrMiddleware(undefined, ['/p/src/routes.ts']);
    // `next()` with no argument is the pass-through branch; `next(err)` is the
    // catch. Asserting only "next was called" would pass against the unfixed
    // code, whose SSR attempt throws on this stub request and lands in `next(err)`.
    const args: unknown[] = [];
    await handler({ url: '/src/routes.ts' }, {}, (...a: unknown[]) =>
      args.push(...(a.length ? a : [undefined]))
    );
    expect(args).toEqual([undefined]);
  });

  it('passes a source module through with a Vite query suffix', async () => {
    const handler = await captureSsrMiddleware(undefined, [
      '/p/src/pages/home.css',
    ]);
    const args: unknown[] = [];
    await handler(
      { url: '/src/pages/home.css?direct' },
      {},
      (...a: unknown[]) => args.push(...(a.length ? a : [undefined]))
    );
    expect(args).toEqual([undefined]);
  });

  it('still sends an application route to SSR when no such file exists', async () => {
    // The mirror of the case above: /about names no project file, so the SSR
    // app must keep it. This is what stops the fix from swallowing routes.
    const handler = await captureSsrMiddleware(undefined, ['/p/src/routes.ts']);
    let nexted = false;
    await handler(
      { url: '/about', headers: {} },
      { setHeader() {}, write() {}, end() {} },
      () => (nexted = true)
    ).catch(() => {});
    expect(nexted).toBe(false);
  });

  it('sends a build-generated asset URL to SSR (no file on disk in dev)', async () => {
    // /llms.txt is an emitted client asset with no source file; the app serves
    // it in dev. An extension-based rule would have wrongly claimed it.
    const handler = await captureSsrMiddleware();
    let nexted = false;
    await handler(
      { url: '/llms.txt', headers: {} },
      { setHeader() {}, write() {}, end() {} },
      () => (nexted = true)
    ).catch(() => {});
    expect(nexted).toBe(false);
  });

  it('does not claim a directory that happens to match the route', async () => {
    // `/src` exists as a folder, but a folder is not something Vite serves. An
    // existence check that stopped at "the path exists" would swallow an app
    // route whose name collides with a directory.
    const handler = await captureSsrMiddleware(undefined, [], ['/p/src']);
    let nexted = false;
    await handler(
      { url: '/src', headers: {} },
      { setHeader() {}, write() {}, end() {} },
      () => (nexted = true)
    ).catch(() => {});
    expect(nexted).toBe(false);
  });

  it('lets devSsrInclude force a real project file to SSR', async () => {
    // The escape hatch has to reach the new branch too, for an app whose route
    // genuinely collides with a file path.
    const handler = await captureSsrMiddleware({ devSsrInclude: ['/src/'] }, [
      '/p/src/routes.ts',
    ]);
    let nexted = false;
    await handler(
      { url: '/src/routes.ts', headers: {} },
      { setHeader() {}, write() {}, end() {} },
      () => (nexted = true)
    ).catch(() => {});
    expect(nexted).toBe(false);
  });
});
