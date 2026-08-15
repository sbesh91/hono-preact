import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { type Plugin } from 'vite';
import { CLIENT_ENTRY_FILE } from '@hono-preact/iso/internal/contract';
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
import { createRootRef } from './root.js';
import type { HonoPreactAdapter, HonoPreactAdapterContext } from './adapter.js';
import { BASELINE_TARGETS } from './css-targets.js';
import { emitClientAsset, type ClientAssets } from './client-assets.js';

export interface HonoPreactCssOptions {
  /**
   * Project-relative (or absolute) path to the app's global stylesheet. When
   * set, the framework owns its delivery: it is bundled through the client
   * build and injected into the SSR head (dev and prod), so the app must NOT
   * also link it manually. Enables the build-time auto-split by default.
   */
  global?: string;
  /**
   * Split the global stylesheet per route chunk at build time.
   * Only meaningful when `global` is set.
   * @default true
   */
  autoSplit?: boolean;

  /**
   * Minimum per-chunk scoped sheet size in bytes; anything smaller stays in
   * the global sheet.
   * @default 1024
   */
  minSize?: number;
}

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

  /** Framework-owned global stylesheet delivery and auto-split tuning. */
  css?: HonoPreactCssOptions;

  /**
   * Generated files emitted into the client build and served from the same
   * thunk in dev, so the two halves cannot drift. Keyed by output file name
   * relative to the client out dir, so `'llms.txt'` serves at `/llms.txt`.
   *
   * The thunk runs once during the build and per request in dev, which is what
   * makes a dev edit appear without restarting the server.
   */
  assets?: ClientAssets;
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
    css,
    assets,
  } = options ?? {};

  if (!adapter) {
    throw new Error(
      '[hono-preact] honoPreact() requires an `adapter` option. ' +
        "Import one, e.g. `import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare'`, " +
        'and pass `honoPreact({ adapter: cloudflareAdapter() })`.'
    );
  }

  const cssGlobal = css?.global;

  const rootRef = createRootRef();

  // Getters, not values: `honoPreact()` runs before any Vite hook, so the root
  // is not yet knowable. Adapters read these fields from their own plugin
  // hooks, by which time `hono-preact:server-entry`'s `config` has resolved it.
  const ctx: HonoPreactAdapterContext = {
    get root() {
      return rootRef.get();
    },
    get coreAppModuleId() {
      return generatedCoreAppAbsPath(rootRef.get());
    },
    get entryWrapperId() {
      return generatedEntryWrapperAbsPath(rootRef.get());
    },
    // Not a getter: the declared names come straight off the options object,
    // so they are known synchronously here and need no lazy resolution.
    assetNames: Object.keys(assets ?? {}),
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
    config(userConfig) {
      rootRef.set(userConfig);
      return {
        resolve: {
          dedupe: [
            'preact',
            'preact/hooks',
            'preact-iso',
            // @preact/signals patches preact.options and Signal.prototype at
            // import and MUST be a singleton; a second copy fails SILENTLY
            // (a computed in one copy never subscribes to a signal from the
            // other). Both entries are needed: the adapter depends on core as
            // a plain nested dep, so deduping the adapter alone still permits
            // two cores.
            '@preact/signals',
            '@preact/signals-core',
          ],
        },
        build: {
          target: 'esnext' as const,
          assetsDir: 'static',
          // Framework-owned CSS minification: the same Lightning CSS engine the
          // auto-splitter uses, so one parser/serializer owns all CSS semantics.
          // Only when the user has not chosen a minifier themselves.
          ...(userConfig.build?.cssMinify === undefined
            ? { cssMinify: 'lightningcss' as const }
            : {}),
        },
        // Baseline-derived lowering targets, unless the user configured their
        // own lightningcss options (theirs win wholesale to avoid partial merges).
        ...(userConfig.css?.lightningcss === undefined
          ? { css: { lightningcss: { targets: BASELINE_TARGETS } } }
          : {}),
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
    // `preact/devtools` needs `include` rather than the scan above, because the
    // scan cannot reach it: `@preact/preset-vite` INJECTS `import
    // "preact/devtools"` in a transform, so it exists in no source file for
    // esbuild's scanner to crawl. It is therefore discovered when the module is
    // first loaded, which is mid-startup, triggering exactly the re-optimize
    // this seeding exists to prevent -- and this one lands after the SSR graph
    // is partly loaded, so the reload leaves two `?v=` instances of every dep
    // live at once. Two `@preact/signals` instances each chain their own
    // `options.__r` hook onto the shared Preact `options`, and both then call
    // `.S()` on the single per-component effect stored at `__$u`: the second
    // sees it already RUNNING and throws `Cycle detected` on EVERY route.
    configEnvironment(name: string) {
      if (name === 'client') return;
      return {
        optimizeDeps: {
          entries: [resolve(rootRef.get(), routes)],
          include: ['preact/devtools'],
        },
      };
    },
  };

  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    clientEntryPlugin({ routes, cssGlobal }),
    clientEntryContractPlugin(clientEntry),
    preloadManifestPlugin({
      routes,
      layout,
      css: cssGlobal
        ? { autoSplit: css?.autoSplit ?? true, minSize: css?.minSize ?? 1024 }
        : undefined,
    }),
    serverEntryPlugin({
      layout,
      routes,
      api,
      appConfig,
      serverDir,
      adapter,
      rootRef,
      cssGlobal,
      assetNames: ctx.assetNames,
    }),
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    routeServerAutodiscoveryPlugin(),
    serverOnlyPlugin(),
    guardStripPlugin(),
    ...(assets ? [emitClientAsset(assets)] : []),
    ...adapter.vitePlugins(ctx),
    ...preact({ reactAliasesEnabled: false }),
  ];
}
