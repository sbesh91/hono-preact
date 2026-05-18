import { honoPreact } from 'hono-preact/vite';
import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';
import mdx, { type Options as MdxOptions } from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import rehypeShiki from '@shikijs/rehype';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

// `__dirname` is not defined in native ESM; Vite's esbuild loader silently
// polyfills it today, but copying this config into a plain `.mjs` or running
// it through a non-esbuild loader breaks. Derive it from `import.meta.url`
// so the file is portable regardless of how it's loaded.
const __dirname = dirname(fileURLToPath(import.meta.url));

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
      // Umbrella subpaths (longest-prefix first).
      {
        find: 'hono-preact/internal',
        replacement: resolve(__dirname, '../../packages/hono-preact/src/internal.ts'),
      },
      {
        find: 'hono-preact/server',
        replacement: resolve(__dirname, '../../packages/hono-preact/src/server.ts'),
      },
      {
        find: 'hono-preact/vite',
        replacement: resolve(__dirname, '../../packages/hono-preact/src/vite.ts'),
      },
      {
        find: 'hono-preact/adapter-cloudflare',
        replacement: resolve(__dirname, '../../packages/hono-preact/src/adapter-cloudflare.ts'),
      },
      {
        find: 'hono-preact',
        replacement: resolve(__dirname, '../../packages/hono-preact/src/index.ts'),
      },
      // Workspace packages kept so the umbrella's `export * from '@hono-preact/iso'`
      // chains through to source for HMR.
      {
        find: '@hono-preact/iso/internal',
        replacement: resolve(__dirname, '../../packages/iso/src/internal.ts'),
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
    honoPreact({ adapter: cloudflareAdapter() }),
    Object.assign(mdx(mdxOptions), { enforce: 'pre' as const }),
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
