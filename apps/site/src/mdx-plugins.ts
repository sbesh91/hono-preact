import type { ProcessorOptions } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeShiki from '@shikijs/rehype';
import { rehypeShikiOptions } from './shiki/shiki-config.js';

type PluggableList = NonNullable<ProcessorOptions['remarkPlugins']>;

// Remark/rehype plugin arrays for the docs MDX pipeline. Extracted from
// vite.config.ts so they can be unit-tested with @mdx-js/mdx's `compile`.
export const remarkPlugins: PluggableList = [remarkGfm];

export const rehypePlugins: PluggableList = [
  // Slug first: it assigns each heading an `id`. The autolink anchor and the
  // build-time heading index both depend on those ids (both use github-slugger
  // so the anchors and the index agree).
  rehypeSlug,
  [
    rehypeAutolinkHeadings,
    {
      behavior: 'append',
      properties: {
        class: 'heading-anchor',
        'aria-label': 'Permalink to this section',
      },
      content: { type: 'text', value: '#' },
    },
  ],
  // Shiki touches code blocks, independent of the heading plugins above.
  [rehypeShiki, rehypeShikiOptions],
];
