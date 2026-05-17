import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nav } from '../nav.js';

// Contract test for the docs routing pipeline.
//
// `apps/site/src/components/DocsRoute.tsx` auto-discovers MDX pages via
// `import.meta.glob('../pages/docs/*.mdx')` and registers one Route per
// file under the outer `/docs` route. `apps/site/src/pages/docs/nav.ts`
// declares the user-facing sidebar manually. If those two lists drift,
// users see a "Docs page not found" fallback for an entry in the sidebar
// (or worse, navigate to a docs page that the sidebar doesn't show).
//
// Vitest can't easily execute `import.meta.glob` outside Vite's bundler,
// and importing MDX would require the @mdx-js/rollup plugin in
// `vitest.config.ts`. Instead we walk the docs directory with `fs` and
// derive the same route slugs DocsRoute would, then check both directions
// against `nav.ts`.

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(__dirname, '..');

function discoverMdxSlugs(): string[] {
  return readdirSync(docsDir)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) =>
      f
        .replace(/\.mdx$/, '')
        // The inner Router in DocsRoute maps index.mdx to the empty path so
        // it serves at `/docs` (not `/docs/index`). nav.ts encodes that as
        // the `/docs` route.
        .replace(/^index$/, '')
    )
    .sort();
}

function navSlugs(): string[] {
  return nav
    .flatMap((section) => section.entries.map((entry) => entry.route))
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

  it('index.mdx becomes the /docs route (empty slug inside the inner Router)', () => {
    // DocsRoute renders `<IsoRoute path="" component={...}>` for index.mdx
    // so the URL `/docs` matches it. The nav.ts entry for the overview is
    // therefore `/docs`, not `/docs/index`.
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
