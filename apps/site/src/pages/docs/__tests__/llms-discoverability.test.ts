import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// PR C surfaces `/llms.txt` (curated index) and `/llms-full.txt` (full corpus)
// in the docs UI. In production they are emitted to the served root by the
// `emit-llms-txt` Vite plugin (static assets); in dev that plugin also serves
// them via a `configureServer` middleware (the Cloudflare dev server does not
// serve the dist/client assets dir, so the worker catch-all would otherwise
// render a not-found page). This gate guards that the affordances and the
// dev-serving stay wired (a source-content gate, like example-code-gate.test.ts;
// the JSX itself is compiled by `site build`).
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

  it('dev server serves /llms.txt and /llms-full.txt (not just the prod build)', () => {
    // Without an explicit dev handler, `pnpm dev` returns the worker's
    // not-found page for these paths (the Cloudflare dev server does not serve
    // the dist/client assets dir). Guard that the configureServer middleware
    // that serves them in dev stays wired.
    const viteConfig = read('../vite.config.ts');
    expect(viteConfig).toContain('configureServer');
    expect(viteConfig).toMatch(/['"]\/llms\.txt['"]/);
    expect(viteConfig).toMatch(/['"]\/llms-full\.txt['"]/);
  });
});
