import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// PR C surfaces the build-time `/llms.txt` (curated index) and `/llms-full.txt`
// (full corpus) in the docs UI. Those files are emitted to the served root by
// the `emit-llms-txt` Vite plugin; this gate guards that the three
// discoverability affordances stay wired (a source-content gate, like
// example-code-gate.test.ts; the JSX itself is compiled by `site build`).
const here = dirname(fileURLToPath(import.meta.url));
const siteSrc = resolve(here, '../../../'); // apps/site/src
const read = (rel: string) => readFileSync(resolve(siteSrc, rel), 'utf8');

describe('llms.txt is discoverable in the docs UI', () => {
  it('docs Overview links both /llms.txt and /llms-full.txt', () => {
    const overview = read('pages/docs/index.mdx');
    expect(overview).toContain('(/llms.txt)');
    expect(overview).toContain('(/llms-full.txt)');
  });

  it('docs topbar links /llms.txt', () => {
    expect(read('components/DocsLayout.tsx')).toContain('href="/llms.txt"');
  });

  it('document head advertises /llms.txt as a plain-text alternate', () => {
    const layout = read('Layout.tsx');
    expect(layout).toMatch(/rel="alternate"/);
    expect(layout).toContain('href="/llms.txt"');
  });
});
