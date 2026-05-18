import preact from '@preact/preset-vite';
import { type Plugin } from 'vite';
import { clientShimPlugin } from './client-shim.js';
import { clientEntryPlugin, VIRTUAL_CLIENT_ENTRY_ID } from './client-entry.js';
import { serverLoaderValidationPlugin } from './server-loader-validation.js';
import { moduleKeyPlugin } from './module-key-plugin.js';
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
  clientEntry?: string; // default 'virtual:hono-preact/client'
}

export function honoPreact(options: HonoPreactOptions): Plugin[] {
  const {
    adapter,
    layout = 'src/Layout.tsx',
    routes = 'src/routes.ts',
    api = 'src/api.ts',
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

  // Only genuinely platform-agnostic config lives here. Client-vs-server
  // build config is owned by the adapter's plugins (Environment API).
  const configPlugin: Plugin = {
    name: 'hono-preact:config',
    config() {
      return {
        resolve: {
          dedupe: ['preact', 'preact/compat', 'preact/hooks', 'preact-iso'],
        },
        build: {
          target: 'esnext' as const,
          assetsDir: 'static',
        },
      };
    },
  };

  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    clientEntryPlugin({ routes }),
    serverEntryPlugin({
      layout,
      routes,
      api,
      adapter,
      coreAppPath,
      entryWrapperPath,
    }),
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    serverOnlyPlugin(),
    guardStripPlugin(),
    ...adapter.vitePlugins(ctx),
    ...preact(),
  ];
}
