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
