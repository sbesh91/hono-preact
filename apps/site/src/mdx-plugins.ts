import type { ProcessorOptions } from '@mdx-js/mdx';
import type { Element, Root } from 'hast';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeShiki from '@shikijs/rehype';
import { SKIP, visit } from 'unist-util-visit';
import { rehypeShikiOptions } from './shiki/shiki-config.js';

type PluggableList = NonNullable<ProcessorOptions['remarkPlugins']>;

const TABLE_WRAP_CLASS = 'table-wrap';

function isTableWrap(node: Element): boolean {
  const className = node.properties?.className;
  return (
    node.tagName === 'div' &&
    Array.isArray(className) &&
    className.includes(TABLE_WRAP_CLASS)
  );
}

// Wrap every GFM table in a `<div class="table-wrap">` so wide API tables get
// their own horizontal scroll on mobile instead of overflowing the page. The
// CSS frame (border/radius/overflow-x) lives on the wrapper; the table keeps
// `width: 100%` so its columns still stretch on desktop.
export function rehypeWrapTables() {
  return (tree: Root) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'table' || !parent || index === undefined) return;
      // Idempotent: skip a table that a previous pass already wrapped.
      if (parent.type === 'element' && isTableWrap(parent)) return;
      const wrapper: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: [TABLE_WRAP_CLASS] },
        children: [node],
      };
      parent.children[index] = wrapper;
      // Continue past the wrapper so the moved table is not revisited (which
      // would wrap it again, forever).
      return [SKIP, index + 1];
    });
  };
}

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
  // Wrap tables for mobile horizontal scroll; independent of the other plugins.
  rehypeWrapTables,
  // Shiki touches code blocks, independent of the heading plugins above.
  [rehypeShiki, rehypeShikiOptions],
];
