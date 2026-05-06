import build from '@hono/vite-build/cloudflare-workers';
import devServer, { defaultOptions } from '@hono/vite-dev-server';
import cloudflareAdapter from '@hono/vite-dev-server/cloudflare';
import { type BuildEnvironmentOptions, type Plugin } from 'vite';
import { serverLoaderValidationPlugin } from './server-loader-validation.js';
import { moduleKeyPlugin } from './module-key-plugin.js';
import { serverOnlyPlugin } from './server-only.js';

export interface HonoPreactOptions {
  entry: string;
  clientBuild?: BuildEnvironmentOptions;
  serverBuild?: BuildEnvironmentOptions;
  sharedBuild?: BuildEnvironmentOptions;
}

export function honoPreact({
  entry,
  clientBuild = {},
  serverBuild = {},
  sharedBuild = {},
}: HonoPreactOptions): Plugin[] {
  return [
    {
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
                input: userRollup?.input ?? ['./src/client.tsx'],
                output: {
                  entryFileNames: 'static/client.js',
                  chunkFileNames: 'static/[name]-[hash].js',
                  assetFileNames: 'static/[name]-[hash].[ext]',
                  // Array-form output is not supported — use an OutputOptions object to
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
    },
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    serverOnlyPlugin(),
    Object.assign(build({ entry }), {
      apply: (_: unknown, { command, mode }: { command: string; mode: string }) =>
        command === 'build' && mode !== 'client',
    }),
    Object.assign(
      devServer({
        entry,
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
  ];
}
