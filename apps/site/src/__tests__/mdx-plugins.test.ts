import { describe, it, expect } from 'vitest';
import { compile } from '@mdx-js/mdx';
import type { Element, Root } from 'hast';
import {
  remarkPlugins,
  rehypePlugins,
  rehypeWrapTables,
} from '../mdx-plugins.js';

describe('mdx-plugins', () => {
  it('assigns slug ids to headings and appends a permalink anchor', async () => {
    const out = String(
      await compile('## Live Loaders Options\n', {
        jsxImportSource: 'preact',
        remarkPlugins,
        rehypePlugins,
      })
    );
    // rehype-slug -> id; rehype-autolink-headings -> an href="#slug" anchor.
    expect(out).toContain('live-loaders-options');
    expect(out).toContain('heading-anchor');
  });

  it('wraps every GFM table in a horizontally scrollable container', async () => {
    const out = String(
      await compile('| A | B |\n| --- | --- |\n| 1 | 2 |\n', {
        jsxImportSource: 'preact',
        remarkPlugins,
        rehypePlugins,
      })
    );
    expect(out).toContain('table-wrap');
  });
});

describe('rehypeWrapTables', () => {
  const table = (): Element => ({
    type: 'element',
    tagName: 'table',
    properties: {},
    children: [],
  });

  it('replaces a table node with a div.table-wrap that holds the table', () => {
    const tree: Root = { type: 'root', children: [table()] };

    rehypeWrapTables()(tree);

    expect(tree.children).toHaveLength(1);
    const wrapper = tree.children[0] as Element;
    expect(wrapper.tagName).toBe('div');
    expect(wrapper.properties?.className).toEqual(['table-wrap']);
    expect(wrapper.children).toHaveLength(1);
    expect((wrapper.children[0] as Element).tagName).toBe('table');
  });

  it('does not double-wrap a table that is already wrapped', () => {
    const tree: Root = { type: 'root', children: [table()] };

    rehypeWrapTables()(tree);
    rehypeWrapTables()(tree);

    const wrapper = tree.children[0] as Element;
    expect(wrapper.tagName).toBe('div');
    expect(wrapper.children).toHaveLength(1);
    expect((wrapper.children[0] as Element).tagName).toBe('table');
  });
});
