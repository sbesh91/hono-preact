import { resolve } from 'node:path';
import * as fs from 'node:fs';
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
import { BASELINE_TARGETS } from './css-targets.js';

export interface HonoPreactCssOptions {
  /**
   * Project-relative (or absolute) path to the app's global stylesheet. When
   * set, the framework owns its delivery: it is bundled through the client
   * build and injected into the SSR head (dev and prod), so the app must NOT
   * also link it manually. Enables the build-time auto-split by default.
   */
  global?: string;
  /** Default true (when `global` is set). Set false to deliver it unsplit. */
  autoSplit?: boolean;
  /** Minimum per-chunk scoped sheet size in bytes; smaller stays global. Default 1024. */
  minSize?: number;
}

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
  /** Framework-owned global stylesheet delivery and auto-split tuning. */
  css?: HonoPreactCssOptions;
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
  } = options ?? {};

  if (!adapter) {
    throw new Error(
      '[hono-preact] honoPreact() requires an `adapter` option. ' +
        "Import one, e.g. `import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare'`, " +
        'and pass `honoPreact({ adapter: cloudflareAdapter() })`.'
    );
  }

  const cssGlobal = css?.global;
  if (cssGlobal !== undefined) {
    const abs = resolve(process.cwd(), cssGlobal);
    // isFile() also rejects '' and directory paths (resolve(cwd, '') is the
    // project dir itself, which exists but is not a stylesheet).
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(
        `[hono-preact] css.global points at '${cssGlobal}', which is not a file. ` +
          `Pass a project-relative path to your global stylesheet, e.g. 'src/styles/root.css'.`
      );
    }
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
    config(userConfig) {
      return {
        resolve: {
          dedupe: ['preact', 'preact/hooks', 'preact-iso'],
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
    configEnvironment(name: string) {
      if (name === 'client') return;
      return { optimizeDeps: { entries: [resolve(ctx.root, routes)] } };
    },
  };

  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    clientEntryPlugin({ routes, cssGlobal }),
    preloadManifestPlugin({
      routes,
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
      coreAppPath,
      entryWrapperPath,
      cssGlobal,
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
