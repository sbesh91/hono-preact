import build from '@hono/vite-build/cloudflare-workers';
import devServer, { defaultOptions } from '@hono/vite-dev-server';
import cloudflareAdapter from '@hono/vite-dev-server/cloudflare';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
// import { visualizer } from 'rollup-plugin-visualizer';
// visualizer({ open: true, filename: 'dist/stats.html', sourcemap: true })

function serverOnlyPlugin(isClientBuild: boolean): Plugin {
  if (!isClientBuild) return { name: 'server-only-noop' };
  return {
    name: 'server-only',
    enforce: 'pre',
    load(id: string) {
      if (/\.server\.[jt]sx?$/.test(id)) {
        return `export const serverLoader = async () => ({});`;
      }
    },
  };
}

export default defineConfig((env) => {
  if (env.mode === 'client') {
    return {
      resolve: {
        alias: [{ find: '@', replacement: resolve(__dirname, './src') }],
      },
      build: {
        target: 'esnext',
        sourcemap: true,
        cssCodeSplit: true,
        assetsDir: 'static',
        ssrEmitAssets: true,
        outDir: resolve(__dirname, 'dist'),
        lib: {
          entry: resolve(__dirname, 'src/client'),
          name: 'client',
          fileName: 'client',
          formats: ['es'],
        },
        rollupOptions: {
          input: ['./src/client.tsx'],
          output: {
            entryFileNames: 'static/client.js',
            chunkFileNames: 'static/[name]-[hash].js',
            assetFileNames: 'static/[name]-[hash].[ext]',
          },
        },
        copyPublicDir: false,
      },
      plugins: [preact(), serverOnlyPlugin(true)],
    };
  }

  return {
    resolve: {
      alias: [{ find: '@', replacement: resolve(__dirname, './src') }],
    },
    build: {
      target: 'esnext',
      assetsDir: 'static',
      ssrEmitAssets: true,
      minify: true,
      rollupOptions: {
        onwarn(warning, warn) {
          if (
            warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
            warning.message.includes(`"use client"`)
          ) {
            return;
          }
          warn(warning);
        },
      },
    },
    plugins: [
      build({
        entry: 'src/server.tsx',
      }),
      devServer({
        entry: 'src/server.tsx',
        exclude: [
          ...defaultOptions.exclude,
          /\.scss/,
          /\.css/,
          /\?url/,
          /\?inline/,
        ],
        adapter: cloudflareAdapter,
      }),
    ],
  };
});
