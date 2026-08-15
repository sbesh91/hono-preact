import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// PR C surfaces `/llms.txt` (curated index) and `/llms-full.txt` (full corpus)
// in the docs UI. Both are declared through `honoPreact({ assets })`, which
// wires a single thunk per file to both halves: the prod build emits it to
// the served root, and the dev server serves it from the same thunk per
// request (the Cloudflare dev server does not serve the dist/client assets
// dir, so the worker catch-all would otherwise render a not-found page).
// This gate guards that the affordances and the `assets` declaration stay
// wired (a source-content gate, like example-code-gate.test.ts; the JSX
// itself is compiled by `site build`).
const here = dirname(fileURLToPath(import.meta.url));
const siteSrc = resolve(here, '../../../'); // apps/site/src
const read = (rel: string) => readFileSync(resolve(siteSrc, rel), 'utf8');

describe('llms.txt is discoverable in the docs UI', () => {
  it('docs Overview links both /llms.txt and /llms-full.txt', () => {
    const overview = read('pages/docs/index.mdx');
    expect(overview).toContain('href="/llms.txt"');
    expect(overview).toContain('href="/llms-full.txt"');
  });

  it('docs topbar links /llms.txt', () => {
    expect(read('components/DocsLayout.tsx')).toContain('href="/llms.txt"');
  });

  it('the llms links are native navigations, not SPA-router soft-navs', () => {
    // preact-iso intercepts same-origin same-tab <a> clicks; /llms.txt is not a
    // route, so a soft-nav lands on the not-found page. The browser does a
    // native navigation (hitting the static asset / dev middleware) only when
    // the link has target!=_self or download. Guard every /llms*.txt anchor in
    // the topbar and the Overview.
    const sources = [
      read('components/DocsLayout.tsx'),
      read('pages/docs/index.mdx'),
    ];
    for (const src of sources) {
      const anchors = src.match(/<a[^>]*href="\/llms[^"]*"[^>]*>/g) ?? [];
      expect(anchors.length).toBeGreaterThan(0);
      for (const a of anchors) {
        expect(a, a).toMatch(/target="_blank"|\bdownload\b/);
      }
    }
  });

  it('document head advertises /llms.txt as a plain-text alternate', () => {
    const layout = read('Layout.tsx');
    expect(layout).toMatch(/rel="alternate"/);
    expect(layout).toContain('href="/llms.txt"');
  });

  it('honoPreact assets declares both llms.txt and llms-full.txt (not just the prod build)', () => {
    // Without an `assets` entry, `pnpm dev` returns the worker's not-found
    // page for these paths (the Cloudflare dev server does not serve the
    // dist/client assets dir). Guard that both keys stay declared, since that
    // one declaration wires the dev-serving half as well as the prod emit.
    const viteConfig = read('../vite.config.ts');
    expect(viteConfig).toMatch(/['"]llms\.txt['"]\s*:/);
    expect(viteConfig).toMatch(/['"]llms-full\.txt['"]\s*:/);
  });
});
