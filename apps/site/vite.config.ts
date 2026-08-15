import { honoPreact } from 'hono-preact/vite';
import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';
import mdx, { type Options as MdxOptions } from '@mdx-js/rollup';
import { remarkPlugins, rehypePlugins } from './src/mdx-plugins.js';
import { highlightPlugin } from './src/shiki/vite-plugin-highlight.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { nav } from './src/pages/docs/nav.js';
import { generateLlmsFiles } from './src/llms/generate-llms.js';
import { docsIndexPlugin } from './src/llms/vite-plugin-docs-index.js';
import { workspaceAliases } from './src/workspace-aliases.js';

// `__dirname` is not defined in native ESM; Vite's esbuild loader silently
// polyfills it today, but copying this config into a plain `.mjs` or running
// it through a non-esbuild loader breaks. Derive it from `import.meta.url`
// so the file is portable regardless of how it's loaded.
const __dirname = dirname(fileURLToPath(import.meta.url));

const mdxOptions = {
  jsxImportSource: 'preact',
  remarkPlugins,
  rehypePlugins,
} satisfies MdxOptions;

const visualize = process.env.VISUALIZE === '1';

// Single source of truth for the version badge on the homepage: read it from
// the framework's own package.json at build time so a release bump propagates
// to the site automatically and the badge can't drift (it sat at v0.2 from
// 0.2 through 0.5 when hardcoded).
const docsDir = resolve(__dirname, 'src/pages/docs');

const frameworkVersion = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../packages/hono-preact/package.json'),
    'utf8'
  )
).version as string;

export default defineConfig((env) => ({
  define: {
    __HONO_PREACT_VERSION__: JSON.stringify(frameworkVersion),
  },
  resolve: {
    // Resolve framework subpaths to workspace `src/` (not published `dist/`,
    // which workerd refuses) so the dev server and build see source directly.
    // Generated from each package's `exports` map so a newly added subpath is
    // covered automatically rather than needing a hand-added entry here
    // (issue #290). Sorted longest-find first, ahead of the `@` app alias, so
    // subpath aliases win under Vite's first-match string matching.
    alias: [
      ...workspaceAliases([
        resolve(__dirname, '../../packages/hono-preact'),
        resolve(__dirname, '../../packages/iso'),
        resolve(__dirname, '../../packages/server'),
      ]),
      { find: '@', replacement: resolve(__dirname, './src') },
    ],
  },
  build: {
    sourcemap: visualize && env.mode === 'client',
  },
  plugins: [
    highlightPlugin(),
    honoPreact({
      adapter: cloudflareAdapter(),
      css: { global: 'src/styles/root.css' },
      assets: {
        // Generated per request in dev, so a docs edit is reflected with no
        // restart and no cache to invalidate by hand.
        'llms.txt': () => generateLlmsFiles(nav, docsDir).llmsTxt,
        'llms-full.txt': () => generateLlmsFiles(nav, docsDir).llmsFullTxt,
      },
    }),
    docsIndexPlugin(nav, docsDir),
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
