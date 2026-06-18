import { describe, it, expect } from 'vitest';
import { highlightCode } from '../highlight.js';

describe('highlightCode', () => {
  it('returns Shiki HTML for tsx source', async () => {
    const html = await highlightCode('const answer: number = 42;', 'tsx');
    expect(html).toContain('class="shiki');
    expect(html).toContain('<pre');
    // The identifier survives as text inside the highlighted markup.
    expect(html).toContain('answer');
  });

  it('emits the dual-theme CSS variables (light + dark)', async () => {
    const html = await highlightCode('const x = 1;', 'tsx');
    // defaultColor: 'light' inlines color:; the dark theme is carried as a
    // --shiki-dark custom property that root.css promotes in dark mode.
    expect(html).toContain('--shiki-dark');
  });
});
