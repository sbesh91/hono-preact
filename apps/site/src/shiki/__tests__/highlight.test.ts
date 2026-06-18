import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { highlightCode } from '../highlight.js';
import { highlightPlugin } from '../vite-plugin-highlight.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, 'fixtures/sample.tsx');

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

describe('highlightPlugin', () => {
  it('ignores ids without the ?highlighted query', async () => {
    const plugin = highlightPlugin();
    const load = plugin.load as (id: string) => Promise<string | null>;
    expect(await load.call({ addWatchFile() {} }, fixture)).toBeNull();
  });

  it('loads a ?highlighted id as a default-exported HTML string', async () => {
    const plugin = highlightPlugin();
    const load = plugin.load as (id: string) => Promise<string | null>;
    const watched: string[] = [];
    const out = await load.call(
      { addWatchFile: (f: string) => watched.push(f) },
      `${fixture}?highlighted`
    );
    expect(out).toContain('export default');
    expect(out).toContain('class=\\"shiki'); // escaped inside the JSON string
    expect(watched).toContain(fixture);
  });
});
