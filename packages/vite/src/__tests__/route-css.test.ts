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
  it("maps a route to its chunk's CSS, keys the empty index pattern under '/', and subtracts the entry's global CSS", () => {
    expect(resolveRouteCssMap(chains, bundle())).toEqual({
      '/': ['/home.css'],
      '/docs/x': ['/docs.css'],
    });
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
