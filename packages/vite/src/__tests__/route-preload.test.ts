import { describe, it, expect } from 'vitest';
import {
  extractRouteChains,
  resolvePreloadMap,
  type ClientManifest,
  type GlobExpander,
} from '../route-preload.js';

const ROUTES_SRC = `
import { defineRoutes, contentRoutes } from 'hono-preact';
import { MdxArticle } from './components/MdxArticle.js';
const routeTree = [
  { path: '/', view: () => import('./pages/home.js') },
  {
    path: '/docs',
    layout: () => import('./components/DocsLayout.js'),
    children: [
      ...contentRoutes(import.meta.glob('./pages/docs/**/*.mdx'), {
        wrapper: MdxArticle,
      }),
      { path: '*', view: () => import('./components/DocsNotFound.js') },
    ],
  },
  {
    path: '/demo',
    layout: () => import('./pages/demo/demo-layout.js'),
    children: [
      { path: '', view: () => import('./pages/demo/index.js') },
      {
        path: 'projects',
        use: requireSession,
        children: [
          { path: ':projectId', view: () => import('./pages/demo/project.js') },
        ],
      },
    ],
  },
  { path: '*', view: () => import('./pages/not-found.js') },
] as const;
export default defineRoutes(routeTree);
`;

const ROUTES_ABS = '/proj/src/routes.ts';

const fakeGlob: GlobExpander = (pattern) => {
  if (pattern === './pages/docs/**/*.mdx') {
    return ['./pages/docs/quick-start.mdx', './pages/docs/routing.mdx'];
  }
  return [];
};

describe('extractRouteChains', () => {
  const chains = extractRouteChains(ROUTES_SRC, ROUTES_ABS, fakeGlob);
  const byPattern = new Map(chains.map((c) => [c.pattern, c.sources]));

  it('maps a top-level literal view to its source', () => {
    expect(byPattern.get('/')).toEqual(['/proj/src/pages/home.js']);
    expect(byPattern.get('*')).toEqual(['/proj/src/pages/not-found.js']);
  });

  it('expands contentRoutes glob entries under the layout, with the layout in the chain', () => {
    expect(byPattern.get('/docs/quick-start')).toEqual([
      '/proj/src/components/DocsLayout.js',
      '/proj/src/pages/docs/quick-start.mdx',
    ]);
    expect(byPattern.get('/docs/routing')).toEqual([
      '/proj/src/components/DocsLayout.js',
      '/proj/src/pages/docs/routing.mdx',
    ]);
  });

  it('includes the layout for a literal leaf inside a layout group', () => {
    expect(byPattern.get('/docs/*')).toEqual([
      '/proj/src/components/DocsLayout.js',
      '/proj/src/components/DocsNotFound.js',
    ]);
  });

  it('accumulates layout ancestors across nested groups and bare groupings', () => {
    // /demo (layout) -> projects (bare grouping, no module) -> :projectId (view)
    expect(byPattern.get('/demo/projects/:projectId')).toEqual([
      '/proj/src/pages/demo/demo-layout.js',
      '/proj/src/pages/demo/project.js',
    ]);
    // index child ('') resolves to the group's own path
    expect(byPattern.get('/demo')).toEqual([
      '/proj/src/pages/demo/demo-layout.js',
      '/proj/src/pages/demo/index.js',
    ]);
  });
});

describe('resolvePreloadMap', () => {
  const manifest: ClientManifest = {
    'virtual:hono-preact/client': {
      file: 'static/client.js',
      isEntry: true,
      imports: ['_jsxRuntime.js', '_hooks.js'],
    },
    '_jsxRuntime.js': { file: 'static/jsxRuntime.js' },
    '_hooks.js': { file: 'static/hooks.js' },
    '_route-active.js': { file: 'static/route-active.js' },
    'src/components/DocsLayout.tsx': {
      file: 'static/DocsLayout.js',
      src: 'src/components/DocsLayout.tsx',
      isDynamicEntry: true,
      imports: ['_jsxRuntime.js', '_hooks.js', '_route-active.js'],
    },
    'src/pages/docs/quick-start.mdx': {
      file: 'static/quick-start.js',
      src: 'src/pages/docs/quick-start.mdx',
      isDynamicEntry: true,
      imports: ['_jsxRuntime.js'],
    },
    'src/pages/home.tsx': {
      file: 'static/home.js',
      src: 'src/pages/home.tsx',
      isDynamicEntry: true,
      imports: ['_jsxRuntime.js', '_hooks.js'],
    },
  };

  const chains = extractRouteChains(ROUTES_SRC, ROUTES_ABS, fakeGlob);
  const map = resolvePreloadMap(chains, manifest, { rootDir: '/proj' });

  it('resolves the matched chain to its chunk hrefs, minus the client-entry closure', () => {
    // DocsLayout pulls jsxRuntime/hooks/route-active; quick-start pulls
    // jsxRuntime. The entry already loads jsxRuntime + hooks, so only
    // DocsLayout, route-active, and quick-start remain.
    expect(map['/docs/quick-start']).toEqual([
      '/static/DocsLayout.js',
      '/static/route-active.js',
      '/static/quick-start.js',
    ]);
  });

  it('subtracts the eager entry closure for a plain leaf', () => {
    expect(map['/']).toEqual(['/static/home.js']);
  });

  it('omits patterns whose chunks are entirely in the entry closure', () => {
    // A pattern resolving only to eager chunks would have no hrefs and is
    // dropped. (No such pattern here; assert the shape stays a string[].)
    for (const hrefs of Object.values(map)) {
      expect(Array.isArray(hrefs)).toBe(true);
      expect(hrefs.length).toBeGreaterThan(0);
    }
  });

  it('respects a non-root base', () => {
    const based = resolvePreloadMap(chains, manifest, {
      rootDir: '/proj',
      base: '/assets/',
    });
    expect(based['/']).toEqual(['/assets/static/home.js']);
  });
});
