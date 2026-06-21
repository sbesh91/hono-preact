import { describe, it, expect } from 'vitest';
import { compile } from '@mdx-js/mdx';
import { remarkPlugins, rehypePlugins } from '../mdx-plugins.js';

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
});
