import build from '@hono/vite-build/cloudflare-workers';
import devServer, { defaultOptions } from '@hono/vite-dev-server';
import cloudflareAdapter from '@hono/vite-dev-server/cloudflare';
import preact from '@preact/preset-vite';
import { type BuildEnvironmentOptions, type Plugin } from 'vite';
import { clientShimPlugin } from './client-shim.js';
import {
  clientEntryPlugin,
  VIRTUAL_CLIENT_ENTRY_ID,
} from './client-entry.js';
import { serverLoaderValidationPlugin } from './server-loader-validation.js';
import { moduleKeyPlugin } from './module-key-plugin.js';
import { serverOnlyPlugin } from './server-only.js';
import { guardStripPlugin } from './guard-strip.js';
import {
  GENERATED_SERVER_ENTRY_RELATIVE,
  generatedServerEntryAbsPath,
  serverEntryPlugin,
} from './server-entry.js';

export interface HonoPreactOptions {
  // Source paths (for the generated server entry). All optional.
  layout?: string;       // default 'src/Layout.tsx'
  routes?: string;       // default 'src/routes.ts'
  api?: string;          // default 'src/api.ts' (only loaded if file exists)
  clientEntry?: string;  // default 'virtual:hono-preact/client'

  // Server entry. Defaults to a generated file the framework writes into the
  // Vite cache directory. Rare override.
  entry?: string;

  // Build-tuning escape hatches (preserved).
  clientBuild?: BuildEnvironmentOptions;
  serverBuild?: BuildEnvironmentOptions;
  sharedBuild?: BuildEnvironmentOptions;
}

export function honoPreact(options: HonoPreactOptions = {}): Plugin[] {
  const {
    layout = 'src/Layout.tsx',
    routes = 'src/routes.ts',
    api = 'src/api.ts',
    clientEntry = VIRTUAL_CLIENT_ENTRY_ID,
    entry,
    clientBuild = {},
    serverBuild = {},
    sharedBuild = {},
  } = options;

  const useGeneratedEntry = entry === undefined;
  const resolvedEntry = entry ?? GENERATED_SERVER_ENTRY_RELATIVE;

  const configPlugin: Plugin = {
    name: 'hono-preact:config',
    config(_, { mode }) {
      const shared = {
        resolve: {
          dedupe: ['preact', 'preact/compat', 'preact/hooks', 'preact-iso'],
        },
        build: {
          target: 'esnext' as const,
          assetsDir: 'static',
          ssrEmitAssets: true,
          minify: true,
          ...sharedBuild,
        },
      };

      if (mode === 'client') {
        const { rollupOptions: userRollup, ...restClientBuild } = clientBuild;
        return {
          ...shared,
          build: {
            ...shared.build,
            sourcemap: true,
            cssCodeSplit: true,
            copyPublicDir: false,
            ...restClientBuild,
            rollupOptions: {
              input: userRollup?.input ?? [clientEntry],
              output: {
                entryFileNames: 'static/client.js',
                chunkFileNames: 'static/[name]-[hash].js',
                assetFileNames: 'static/[name]-[hash].[ext]',
                // Array-form output is not supported; use an OutputOptions object to
                // override individual fields (entryFileNames, chunkFileNames, etc.).
                ...(userRollup?.output && !Array.isArray(userRollup.output)
                  ? userRollup.output
                  : {}),
              },
            },
          },
        };
      }

      return {
        ...shared,
        ssr: {
          noExternal: [
            'preact-render-to-string',
            'preact-iso',
            'hono-preact',
            '@hono-preact/iso',
            '@hono-preact/server',
          ],
        },
        build: {
          ...shared.build,
          ...serverBuild,
        },
      };
    },
  };

  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    clientEntryPlugin({ routes }),
    ...(useGeneratedEntry
      ? [serverEntryPlugin({ layout, routes, api, outputPath: generatedServerEntryAbsPath() })]
      : []),
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    serverOnlyPlugin(),
    guardStripPlugin(),
    Object.assign(build({ entry: resolvedEntry }), {
      apply: (_: unknown, { command, mode }: { command: string; mode: string }) =>
        command === 'build' && mode !== 'client',
    }),
    Object.assign(
      devServer({
        entry: resolvedEntry,
        exclude: [
          ...defaultOptions.exclude,
          /\.scss/,
          /\.css/,
          /\?url/,
          /\?inline/,
        ],
        adapter: cloudflareAdapter,
      }),
      { apply: 'serve' as const }
    ),
    ...preact(),
  ];
}
