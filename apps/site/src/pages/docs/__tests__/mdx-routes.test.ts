import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nav } from '../nav.js';

// Contract test for the docs routing pipeline.
//
// `apps/site/src/routes.ts` feeds `import.meta.glob('./pages/docs/**/*.mdx')`
// to `contentRoutes`, which registers one route per file (recursively) under
// the `/docs` layout group. `apps/site/src/pages/docs/nav.ts` declares the
// user-facing sidebar manually. If those two lists drift, users see a "Docs
// page not found" fallback for a sidebar entry (or navigate to a docs page the
// sidebar doesn't show).
//
// Vitest can't easily execute `import.meta.glob` outside Vite's bundler, and
// importing MDX would require the @mdx-js/rollup plugin in `vitest.config.ts`.
// Instead we walk the docs directory with `fs` and derive the same route slugs
// contentRoutes would, then check both directions against `nav.ts`.

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(__dirname, '..');

function discoverMdxSlugs(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(
          resolve(dir, entry.name),
          prefix ? `${prefix}/${entry.name}` : entry.name
        );
      } else if (entry.name.endsWith('.mdx')) {
        const base = entry.name.replace(/\.mdx$/, '');
        const rel = prefix ? `${prefix}/${base}` : base;
        out.push(rel.replace(/(^|\/)index$/, ''));
      }
    }
  };
  walk(docsDir, '');
  return out.sort();
}

function navSlugs(): string[] {
  return nav
    .flatMap((area) =>
      area.sections.flatMap((s) => s.entries.map((e) => e.route))
    )
    .filter((route) => route === '/docs' || route.startsWith('/docs/'))
    .map((route) => (route === '/docs' ? '' : route.replace('/docs/', '')))
    .sort();
}

describe('docs route discovery', () => {
  it('every MDX file in pages/docs/ has a corresponding nav entry', () => {
    const fromGlob = discoverMdxSlugs();
    const fromNav = navSlugs();
    const missing = fromGlob.filter((s) => !fromNav.includes(s));
    expect(
      missing,
      `MDX files without a nav.ts entry: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('every nav.ts entry under /docs points at an MDX file that exists on disk', () => {
    const fromGlob = discoverMdxSlugs();
    const fromNav = navSlugs();
    const stale = fromNav.filter((s) => !fromGlob.includes(s));
    expect(
      stale,
      `nav.ts entries that reference missing MDX files: ${stale.join(', ')}`
    ).toEqual([]);
  });

  it('index.mdx becomes the /docs route (empty slug)', () => {
    // contentRoutes maps index.mdx to the empty slug, so the URL `/docs`
    // matches it. The nav.ts entry for the overview is therefore `/docs`,
    // not `/docs/index`.
    const indexExists = readdirSync(docsDir).includes('index.mdx');
    expect(indexExists, 'expected index.mdx in apps/site/src/pages/docs/').toBe(
      true
    );
    expect(
      navSlugs(),
      'expected nav.ts to include the empty slug for /docs'
    ).toContain('');
  });
});
