import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { type Plugin } from 'vite';
import { CLIENT_ENTRY_FILE } from '@hono-preact/iso/internal/runtime';
import { clientShimPlugin } from './client-shim.js';
import { clientEntryPlugin, VIRTUAL_CLIENT_ENTRY_ID } from './client-entry.js';
import { clientEntryContractPlugin } from './client-entry-contract.js';
import { preloadManifestPlugin } from './preload-manifest.js';
import { serverLoaderValidationPlugin } from './server-loader-validation.js';
import { moduleKeyPlugin } from './module-key-plugin.js';
import { routeServerAutodiscoveryPlugin } from './route-server-autodiscovery.js';
import { serverOnlyPlugin } from './server-only.js';
import { guardStripPlugin } from './guard-strip.js';
import {
  generatedCoreAppAbsPath,
  generatedEntryWrapperAbsPath,
  serverEntryPlugin,
} from './server-entry.js';
import type { HonoPreactAdapter, HonoPreactAdapterContext } from './adapter.js';

export interface HonoPreactOptions {
  /** Deployment target. Required. See hono-preact/adapter-cloudflare. */
  adapter: HonoPreactAdapter;

  // Source paths (for the generated core app module). All optional.

  /**
   * Root layout component path.
   * @default 'src/Layout.tsx'
   */
  layout?: string;

  /**
   * Route table path.
   * @default 'src/routes.ts'
   */
  routes?: string;

  /**
   * Optional custom Hono routes; only loaded if the file exists.
   * @default 'src/api.ts'
   */
  api?: string;

  /**
   * Optional app config; only loaded if the file exists.
   * @default 'src/app-config.ts'
   */
  appConfig?: string;

  /**
   * Registry folder for route-less server modules; globbed only if the
   * directory exists.
   * @default 'src/server'
   */
  serverDir?: string;

  /**
   * Client entry module id.
   * @default 'virtual:hono-preact/client'
   */
  clientEntry?: string;
}

export function honoPreact(options: HonoPreactOptions): Plugin[] {
  // `?? {}` is deliberate: TypeScript types `options` as required, but a
  // zero-arg `honoPreact()` call still reaches here at runtime. Without the
  // fallback, destructuring `undefined` throws a cryptic TypeError; with it,
  // the friendly `adapter`-required guard below fires instead.
  const {
    adapter,
    layout = 'src/Layout.tsx',
    routes = 'src/routes.ts',
    api = 'src/api.ts',
    appConfig = 'src/app-config.ts',
    serverDir = 'src/server',
    clientEntry = VIRTUAL_CLIENT_ENTRY_ID,
  } = options ?? {};

  if (!adapter) {
    throw new Error(
      '[hono-preact] honoPreact() requires an `adapter` option. ' +
        "Import one, e.g. `import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare'`, " +
        'and pass `honoPreact({ adapter: cloudflareAdapter() })`.'
    );
  }

  const coreAppPath = generatedCoreAppAbsPath();
  const entryWrapperPath = generatedEntryWrapperAbsPath();
  const ctx: HonoPreactAdapterContext = {
    root: process.cwd(),
    coreAppModuleId: coreAppPath,
    entryWrapperId: entryWrapperPath,
  };

  // The root every post-config path decision resolves against. `ctx.root`
  // (process.cwd() at honoPreact() call time) is only the pre-config
  // fallback handed to the adapter contract: under a custom Vite `root` the
  // two differ, and resolving against cwd silently points at the wrong tree.
  // The `config` hook below updates this to the configured root before Vite
  // calls any `configEnvironment` hook.
  let resolvedRoot = ctx.root;

  // Shared config plus the `client` build environment's input. The worker
  // environment is configured by the adapter's plugins; the `client`
  // environment's entry is framework-owned (every adapter needs the same
  // browser bundle) so it lives here. Without it, the client environment has
  // no input and `vite build` emits no client JavaScript. The
  // `static/client.js` entry name is the URL the SSR layer references and
  // must stay stable.
  const configPlugin: Plugin = {
    name: 'hono-preact:config',
    config(userConfig) {
      resolvedRoot = userConfig.root ? resolve(userConfig.root) : process.cwd();
      return {
        resolve: {
          dedupe: ['preact', 'preact/hooks', 'preact-iso'],
        },
        build: {
          target: 'esnext' as const,
          assetsDir: 'static',
        },
        environments: {
          client: {
            build: {
              rollupOptions: {
                input: [clientEntry],
                output: {
                  entryFileNames: CLIENT_ENTRY_FILE,
                  chunkFileNames: 'static/[name]-[hash].js',
                  assetFileNames: 'static/[name]-[hash].[ext]',
                },
              },
            },
          },
        },
      };
    },
    // Seed every non-client environment's dep optimizer with the routes
    // manifest as a scan entry, so esbuild crawls the full route graph at
    // startup and pre-bundles every dep the routes reach (framework and app
    // alike). Without this, deps behind the route views' dynamic imports and
    // the docs content-glob are discovered at request time; the resulting
    // re-optimize + program-reload races the async prerender and swaps the
    // Preact module instance mid-render (the `__H` crash). `configEnvironment`
    // is called once per environment with its name, so `name !== 'client'`
    // covers the Node `ssr` env and the Cloudflare worker env alike, with no
    // per-adapter code and without knowing the adapter's env name.
    configEnvironment(name: string) {
      if (name === 'client') return;
      return { optimizeDeps: { entries: [resolve(resolvedRoot, routes)] } };
    },
  };

  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    clientEntryPlugin({ routes }),
    clientEntryContractPlugin(clientEntry),
    preloadManifestPlugin({ routes }),
    serverEntryPlugin({
      layout,
      routes,
      api,
      appConfig,
      serverDir,
      adapter,
      coreAppPath,
      entryWrapperPath,
    }),
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    routeServerAutodiscoveryPlugin(),
    serverOnlyPlugin(),
    guardStripPlugin(),
    ...adapter.vitePlugins(ctx),
    ...preact({ reactAliasesEnabled: false }),
  ];
}
