import { describe, it, expect } from 'vitest';
import { renderComment } from '../render-framework-size-comment.mjs';

const base = {
  sectionA: {
    core: { total: 4000, marginal: 4000 },
    loaders: { total: 5000, marginal: 1000 },
  },
  sectionC: {
    'ui-core': { total: 1400, marginal: 1400 },
    dialog: { total: 2000, marginal: 600 },
  },
};

describe('renderComment', () => {
  it('shows core total and feature marginal with unchanged delta', () => {
    const md = renderComment(base, base);
    expect(md).toContain('<!-- framework-size -->');
    expect(md).toContain('## Framework JS size');
    expect(md).toContain('### Framework runtime (gzip)');
    expect(md).toContain('| core | 4.0 KB | — |');
    expect(md).toContain('| loaders | 1.0 KB | — |');
    expect(md).toContain('### Components (gzip)');
    expect(md).toContain('| ui-core | 1.4 KB | — |');
    expect(md).toContain('| dialog | 600 B | — |');
  });

  it('frames the runtime section so always-on rows are not read as opt-in', () => {
    const md = renderComment(
      {
        sectionA: {
          core: { total: 4000, marginal: 4000 },
          runtime: { total: 6400, marginal: 2400 },
        },
        sectionC: {},
      },
      { sectionA: {}, sectionC: {} }
    );
    // The caption must distinguish the always-on baseline (core + runtime) from
    // the opt-in feature rows; `runtime` ships on every route despite sitting in
    // the feature table.
    expect(md).toMatch(/always-on/i);
    expect(md).toContain('every route');
    expect(md).toContain('| runtime | 2.4 KB | (new) |');
  });

  it('renders the docs-site baseline section from real-build site data', () => {
    const md = renderComment(base, base, undefined, {
      fresh: { baseline: { gzip: 19285, raw: 48533, chunks: 14 } },
      base: { baseline: { gzip: 19000, raw: 48000, chunks: 14 } },
    });
    expect(md).toContain('Docs-site shipped JS');
    expect(md).toContain('| always-loaded | 19.3 KB | +285 B |');
  });

  it('omits the docs-site section when no site data is passed', () => {
    expect(renderComment(base, base)).not.toContain('Docs-site shipped JS');
  });

  it('renders the docs-site CSS section from real-build site data', () => {
    const md = renderComment(base, base, undefined, {
      fresh: {
        baseline: { gzip: 19285, raw: 48533, chunks: 14 },
        css: {
          global: { gzip: 1200, raw: 4000, files: 1 },
          routes: { '/docs/x': { gzip: 300, raw: 900 } },
        },
      },
      base: {
        baseline: { gzip: 19000, raw: 48000, chunks: 14 },
        css: {
          global: { gzip: 1100, raw: 3800, files: 1 },
          routes: { '/docs/x': { gzip: 300, raw: 900 } },
        },
      },
    });
    expect(md).toContain('Docs-site CSS');
    expect(md).toContain('| global (always-loaded) | 1.2 KB | +100 B |');
    expect(md).toContain('/docs/x');
  });

  it('omits the docs-site CSS section when the site report has no css block', () => {
    const md = renderComment(base, base, undefined, {
      fresh: { baseline: { gzip: 19285, raw: 48533, chunks: 14 } },
      base: { baseline: { gzip: 19000, raw: 48000, chunks: 14 } },
    });
    expect(md).not.toContain('Docs-site CSS');
  });

  it('renders increase, new, decrease and removed', () => {
    const fresh = {
      sectionA: {
        core: { total: 4000, marginal: 4000 },
        loaders: { total: 5200, marginal: 1200 },
        actions: { total: 4300, marginal: 300 },
      },
      sectionC: { 'ui-core': { total: 1300, marginal: 1300 } },
    };
    const md = renderComment(fresh, base);
    expect(md).toContain('| loaders | 1.2 KB | +200 B |');
    expect(md).toContain('| actions | 300 B | (new) |');
    expect(md).toContain('| ui-core | 1.3 KB | -100 B |');
    expect(md).toContain('| dialog | (removed) | |');
  });
});
