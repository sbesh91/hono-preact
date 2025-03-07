import build from '@hono/vite-build/node';
import devServer, { defaultOptions } from '@hono/vite-dev-server';
import nodeAdapter from '@hono/vite-dev-server/node';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

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
      plugins: [preact()],
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
        adapter: nodeAdapter,
      }),
    ],
  };
});
