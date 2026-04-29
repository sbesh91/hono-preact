import { honoPreact } from '@hono-preact/vite';
import preact from '@preact/preset-vite';
import mdx, { type Options as MdxOptions } from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import rehypeShiki from '@shikijs/rehype';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

const mdxOptions = {
  jsxImportSource: 'preact',
  remarkPlugins: [remarkGfm],
  rehypePlugins: [
    [
      rehypeShiki,
      { theme: 'github-dark', langs: ['ts', 'tsx', 'bash', 'jsonc', 'mdx'] },
    ],
  ],
} satisfies MdxOptions;

const visualize = process.env.VISUALIZE === '1';

export default defineConfig((env) => ({
  resolve: {
    alias: [
      {
        find: '@hono-preact/iso/v3',
        replacement: resolve(__dirname, '../../packages/iso/src/v3/index.ts'),
      },
      {
        find: '@hono-preact/iso',
        replacement: resolve(__dirname, '../../packages/iso/src/index.ts'),
      },
      {
        find: '@hono-preact/server',
        replacement: resolve(__dirname, '../../packages/server/src/index.ts'),
      },
      { find: '@', replacement: resolve(__dirname, './src') },
    ],
  },
  build: {
    sourcemap: visualize && env.mode === 'client',
  },
  plugins: [
    honoPreact({ entry: 'src/server.tsx' }),
    Object.assign(mdx(mdxOptions), { enforce: 'pre' as const }),
    preact(),
    ...(visualize && env.mode === 'client'
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
}));
