import build from '@hono/vite-build/cloudflare-workers';
import devServer, { defaultOptions } from '@hono/vite-dev-server';
import cloudflareAdapter from '@hono/vite-dev-server/cloudflare';
import preact from '@preact/preset-vite';
import mdx, { type Options as MdxOptions } from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import rehypeShiki from '@shikijs/rehype';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import {
  serverLoaderValidationPlugin,
  serverOnlyPlugin,
} from '@hono-preact/vite';

const mdxOptions = {
  jsxImportSource: 'preact',
  remarkPlugins: [remarkGfm],
  rehypePlugins: [[rehypeShiki, { theme: 'github-dark', langs: ['ts', 'tsx', 'bash', 'jsonc', 'mdx'] }]],
} satisfies MdxOptions;

export default defineConfig((env) => {
  const isoSrc = resolve(__dirname, '../../packages/iso/src/index.ts');
  const serverSrc = resolve(__dirname, '../../packages/server/src/index.ts');

  const sharedResolve = {
    dedupe: ['preact', 'preact/compat', 'preact/hooks', 'preact-iso'],
    alias: [
      { find: '@hono-preact/iso', replacement: isoSrc },
      { find: '@hono-preact/server', replacement: serverSrc },
      { find: '@', replacement: resolve(__dirname, './src') },
    ],
  };

  if (env.mode === 'client' || env.mode === 'visualizer') {
    return {
      resolve: sharedResolve,
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
      plugins: [
        Object.assign(mdx(mdxOptions), { enforce: 'pre' as const }),
        preact(),
        serverOnlyPlugin(true),
        ...(env.mode === 'visualizer'
          ? [
              visualizer({
                open: true,
                filename: 'dist/stats.html',
                sourcemap: true,
                gzipSize: true,
              }),
            ]
          : []),
      ],
    };
  }

  return {
    resolve: sharedResolve,
    ssr: {
      noExternal: ['preact-render-to-string', 'preact-iso', '@hono-preact/iso', '@hono-preact/server'],
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
      Object.assign(mdx(mdxOptions), { enforce: 'pre' as const }),
      serverLoaderValidationPlugin(),
      serverOnlyPlugin(),
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
