import preact from '@preact/preset-vite';
import { type Plugin } from 'vite';
import { CLIENT_ENTRY_FILE } from '@hono-preact/iso/internal/runtime';
import { clientShimPlugin } from './client-shim.js';
import { clientEntryPlugin, VIRTUAL_CLIENT_ENTRY_ID } from './client-entry.js';
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
  layout?: string; // default 'src/Layout.tsx'
  routes?: string; // default 'src/routes.ts'
  api?: string; // default 'src/api.ts' (only loaded if file exists)
  appConfig?: string; // default 'src/app-config.ts' (only loaded if file exists)
  serverDir?: string; // default 'src/server' (registry glob; only if the dir exists)
  clientEntry?: string; // default 'virtual:hono-preact/client'
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

  // Shared config plus the `client` build environment's input. The worker
  // environment is configured by the adapter's plugins; the `client`
  // environment's entry is framework-owned (every adapter needs the same
  // browser bundle) so it lives here. Without it, the client environment has
  // no input and `vite build` emits no client JavaScript. The
  // `static/client.js` entry name is the URL the SSR layer references and
  // must stay stable.
  const configPlugin: Plugin = {
    name: 'hono-preact:config',
    config() {
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
  };

  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    clientEntryPlugin({ routes }),
    preloadManifestPlugin(),
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
