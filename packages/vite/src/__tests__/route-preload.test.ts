import { describe, it, expect } from 'vitest';
import {
  extractRouteChains,
  resolvePreloadMap,
  type RouteBundleChunkLike,
} from '../route-preload.js';

const ROUTES = '/proj/src/routes.ts';

// A glob expander stub: maps a literal pattern to a fixed key set so the walker
// tests don't touch the filesystem.
function fakeGlob(keys: Record<string, string[]>) {
  return (globPattern: string): string[] => keys[globPattern] ?? [];
}

describe('extractRouteChains', () => {
  it('extracts a single leaf view chain', () => {
    const chains = extractRouteChains(
      `import { defineRoutes } from 'hono-preact';
       export default defineRoutes([
         { path: '/', view: () => import('./pages/home.js') },
       ]);`,
      ROUTES,
      fakeGlob({})
    );
    expect(chains).toEqual([
      { pattern: '/', sources: ['/proj/src/pages/home.js'] },
    ]);
  });

  it('accumulates layout ancestors down to each leaf', () => {
    const chains = extractRouteChains(
      `export default defineRoutes([
         { path: '/docs', layout: () => import('./DocsLayout.js'), children: [
           { path: 'intro', view: () => import('./pages/intro.js') },
         ]},
       ]);`,
      ROUTES,
      fakeGlob({})
    );
    expect(chains).toEqual([
      {
        pattern: '/docs/intro',
        sources: ['/proj/src/DocsLayout.js', '/proj/src/pages/intro.js'],
      },
    ]);
  });

  it('prefixes children of a bare grouping without a layout module', () => {
    const chains = extractRouteChains(
      `export default defineRoutes([
         { path: '/g', children: [
           { path: 'a', view: () => import('./a.js') },
         ]},
       ]);`,
      ROUTES,
      fakeGlob({})
    );
    expect(chains).toEqual([{ pattern: '/g/a', sources: ['/proj/src/a.js'] }]);
  });

  it('expands a contentRoutes glob spread with the default slug rules', () => {
    const chains = extractRouteChains(
      `export default defineRoutes([
         { path: '/docs', layout: () => import('./DocsLayout.js'), children: [
           ...contentRoutes(import.meta.glob('./pages/docs/**/*.mdx')),
         ]},
       ]);`,
      ROUTES,
      fakeGlob({
        './pages/docs/**/*.mdx': [
          './pages/docs/index.mdx',
          './pages/docs/quick-start.mdx',
        ],
      })
    );
    // common dir prefix is ./pages/docs/, default slug strips index -> '' and
    // the extension. index.mdx maps to the layout root, quick-start to its slug.
    expect(chains).toContainEqual({
      pattern: '/docs/quick-start',
      sources: [
        '/proj/src/DocsLayout.js',
        '/proj/src/pages/docs/quick-start.mdx',
      ],
    });
    expect(chains).toContainEqual({
      pattern: '/docs',
      sources: ['/proj/src/DocsLayout.js', '/proj/src/pages/docs/index.mdx'],
    });
  });

  it('skips a contentRoutes with a custom slug rather than emit wrong hints', () => {
    const warnings: string[] = [];
    const chains = extractRouteChains(
      `export default defineRoutes([
         { path: '/docs', layout: () => import('./DocsLayout.js'), children: [
           ...contentRoutes(import.meta.glob('./x/*.mdx'), { slug: (k) => k }),
         ]},
       ]);`,
      ROUTES,
      fakeGlob({ './x/*.mdx': ['./x/a.mdx'] }),
      (m) => warnings.push(m)
    );
    expect(chains).toEqual([]);
    expect(warnings.join('\n')).toMatch(/custom slug/);
  });

  it('skips a non-literal view thunk with a warning', () => {
    const warnings: string[] = [];
    const chains = extractRouteChains(
      `export default defineRoutes([
         { path: '/', view: someThunk },
       ]);`,
      ROUTES,
      fakeGlob({}),
      (m) => warnings.push(m)
    );
    expect(chains).toEqual([]);
    expect(warnings.join('\n')).toMatch(/not a literal import/);
  });
});

// Minimal Rollup-output-bundle shape resolvePreloadMap reads.
function chunk(
  fileName: string,
  opts: {
    moduleIds?: string[];
    imports?: string[];
    isEntry?: boolean;
  } = {}
): RouteBundleChunkLike {
  return {
    type: 'chunk',
    fileName,
    isEntry: opts.isEntry ?? false,
    moduleIds: opts.moduleIds ?? [],
    imports: opts.imports ?? [],
  };
}

describe('resolvePreloadMap', () => {
  it('resolves a chain to high (layout) + low (view), subtracting the entry closure', () => {
    const bundle: Record<string, RouteBundleChunkLike> = {
      'static/client.js': chunk('static/client.js', {
        isEntry: true,
        moduleIds: ['/proj/src/client.tsx'],
        imports: ['static/jsxRuntime.js'],
      }),
      'static/jsxRuntime.js': chunk('static/jsxRuntime.js'),
      'static/DocsLayout-BBBB.js': chunk('static/DocsLayout-BBBB.js', {
        moduleIds: ['/proj/src/DocsLayout.tsx'],
        // shared jsxRuntime is in the entry closure -> subtracted
        imports: ['static/jsxRuntime.js'],
      }),
      'static/intro-CCCC.js': chunk('static/intro-CCCC.js', {
        moduleIds: ['/proj/src/pages/intro.tsx'],
        imports: ['static/jsxRuntime.js'],
      }),
    };
    const chains = [
      {
        pattern: '/docs/intro',
        sources: ['/proj/src/DocsLayout.js', '/proj/src/pages/intro.js'],
      },
    ];
    const map = resolvePreloadMap(chains, bundle);
    expect(map).toEqual({
      '/docs/intro': {
        high: ['/static/DocsLayout-BBBB.js'],
        low: ['/static/intro-CCCC.js'],
      },
    });
  });

  it('does not duplicate a chunk shared by layout and view (kept in high only)', () => {
    const bundle: Record<string, RouteBundleChunkLike> = {
      'static/client.js': chunk('static/client.js', { isEntry: true }),
      'static/shared-SH.js': chunk('static/shared-SH.js', {
        moduleIds: ['/proj/src/shared.tsx'],
      }),
      'static/layout-LL.js': chunk('static/layout-LL.js', {
        moduleIds: ['/proj/src/Layout.tsx'],
        imports: ['static/shared-SH.js'],
      }),
      'static/view-VV.js': chunk('static/view-VV.js', {
        moduleIds: ['/proj/src/view.tsx'],
        imports: ['static/shared-SH.js'],
      }),
    };
    const chains = [
      {
        pattern: '/x',
        sources: ['/proj/src/Layout.js', '/proj/src/view.js'],
      },
    ];
    const map = resolvePreloadMap(chains, bundle);
    expect(map['/x'].high).toContain('/static/shared-SH.js');
    expect(map['/x'].low).not.toContain('/static/shared-SH.js');
    expect(map['/x'].low).toEqual(['/static/view-VV.js']);
  });

  it('omits a pattern whose chunks are entirely in the entry closure', () => {
    const bundle: Record<string, RouteBundleChunkLike> = {
      'static/client.js': chunk('static/client.js', {
        isEntry: true,
        imports: ['static/eager-EE.js'],
      }),
      'static/eager-EE.js': chunk('static/eager-EE.js', {
        moduleIds: ['/proj/src/eager.tsx'],
      }),
    };
    const chains = [{ pattern: '/e', sources: ['/proj/src/eager.js'] }];
    expect(resolvePreloadMap(chains, bundle)).toEqual({});
  });
});
