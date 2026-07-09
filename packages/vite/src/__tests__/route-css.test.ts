import { describe, it, expect } from 'vitest';
import {
  resolveRouteCssMap,
  type RouteModuleChain,
  type RouteBundleChunkLike,
} from '../route-preload.js';

// A tiny bundle: an entry that imports global.css, a home view chunk that
// imports home.css, and a docs layout + docs page that both import docs.css.
function bundle(): Record<string, RouteBundleChunkLike> {
  const css = (fileName: string): RouteBundleChunkLike => ({
    type: 'asset',
    fileName,
  });
  const chunk = (
    fileName: string,
    moduleIds: string[],
    importedCss: string[],
    opts: { isEntry?: boolean; imports?: string[] } = {}
  ): RouteBundleChunkLike => ({
    type: 'chunk',
    fileName,
    isEntry: opts.isEntry ?? false,
    imports: opts.imports ?? [],
    moduleIds,
    viteMetadata: { importedCss: new Set(importedCss) },
  });
  return {
    'client.js': chunk('client.js', ['/app/entry.ts'], ['global.css'], {
      isEntry: true,
    }),
    'home.js': chunk('home.js', ['/app/pages/home.tsx'], ['home.css']),
    'docs-layout.js': chunk(
      'docs-layout.js',
      ['/app/components/DocsLayout.tsx'],
      ['docs.css']
    ),
    'docs-page.js': chunk(
      'docs-page.js',
      ['/app/pages/docs/x.mdx'],
      ['docs.css']
    ),
    'global.css': css('global.css'),
    'home.css': css('home.css'),
    'docs.css': css('docs.css'),
  };
}

const chains: RouteModuleChain[] = [
  { pattern: '', sources: ['/app/pages/home.tsx'] },
  {
    pattern: '/docs/x',
    sources: ['/app/components/DocsLayout.tsx', '/app/pages/docs/x.mdx'],
  },
];

describe('resolveRouteCssMap', () => {
  it("maps a route to its chunk's CSS and keys the empty index pattern under '/' (entry-only CSS never appears because no route chunk imports it)", () => {
    expect(resolveRouteCssMap(chains, bundle())).toEqual({
      '/': ['/home.css'],
      '/docs/x': ['/docs.css'],
    });
  });

  it("does NOT drop a route's stylesheet just because the entry closure also imports it (no eager-CSS subtraction; a route lists every stylesheet its own chunks import)", () => {
    const b = bundle();
    // The home chunk imports both its own CSS and a "shared.css" that the entry
    // closure ALSO imports (e.g. a component both a global layout and the home
    // view use). Nothing SSR-injects the entry closure's CSS, so shared.css must
    // still appear in the route's own list or the route loses that stylesheet.
    b['home.js'] = {
      type: 'chunk',
      fileName: 'home.js',
      isEntry: false,
      imports: [],
      moduleIds: ['/app/pages/home.tsx'],
      viteMetadata: { importedCss: new Set(['home.css', 'shared.css']) },
    };
    b['client.js'] = {
      type: 'chunk',
      fileName: 'client.js',
      isEntry: true,
      imports: [],
      moduleIds: ['/app/entry.ts'],
      viteMetadata: { importedCss: new Set(['global.css', 'shared.css']) },
    };
    b['shared.css'] = { type: 'asset', fileName: 'shared.css' };
    expect(resolveRouteCssMap(chains, b)['/']).toEqual([
      '/home.css',
      '/shared.css',
    ]);
  });

  it('dedupes a stylesheet shared across the chain (layout + page both import docs.css)', () => {
    const out = resolveRouteCssMap(chains, bundle());
    expect(out['/docs/x']).toEqual(['/docs.css']);
  });

  it('omits a route whose chunks import no CSS', () => {
    const b = bundle();
    b['home.js'] = {
      type: 'chunk',
      fileName: 'home.js',
      isEntry: false,
      imports: [],
      moduleIds: ['/app/pages/home.tsx'],
      viteMetadata: { importedCss: new Set() },
    };
    expect(resolveRouteCssMap(chains, b)['/']).toBeUndefined();
  });

  it('orders distinct layout and view CSS outer-to-inner', () => {
    const b = bundle();
    b['docs-layout.js'] = {
      type: 'chunk',
      fileName: 'docs-layout.js',
      isEntry: false,
      imports: [],
      moduleIds: ['/app/components/DocsLayout.tsx'],
      viteMetadata: { importedCss: new Set(['layout.css']) },
    };
    b['docs-page.js'] = {
      type: 'chunk',
      fileName: 'docs-page.js',
      isEntry: false,
      imports: [],
      moduleIds: ['/app/pages/docs/x.mdx'],
      viteMetadata: { importedCss: new Set(['view.css']) },
    };
    b['layout.css'] = { type: 'asset', fileName: 'layout.css' };
    b['view.css'] = { type: 'asset', fileName: 'view.css' };
    delete b['docs.css'];
    expect(resolveRouteCssMap(chains, b)['/docs/x']).toEqual([
      '/layout.css',
      '/view.css',
    ]);
  });

  it('unions CSS when two chains resolve to the same pattern', () => {
    const b = bundle();
    b['home-alt.js'] = {
      type: 'chunk',
      fileName: 'home-alt.js',
      isEntry: false,
      imports: [],
      moduleIds: ['/app/pages/home-alt.tsx'],
      viteMetadata: { importedCss: new Set(['extra.css']) },
    };
    b['extra.css'] = { type: 'asset', fileName: 'extra.css' };
    const withCollision: RouteModuleChain[] = [
      ...chains,
      { pattern: '', sources: ['/app/pages/home-alt.tsx'] },
    ];
    expect(resolveRouteCssMap(withCollision, b)['/']).toEqual([
      '/home.css',
      '/extra.css',
    ]);
  });
});
