import { describe, it, expect } from 'vitest';
import { fuzzyScore, searchDocs } from '../search.js';
import type { DocPage } from '../../../llms/generate-docs-index.js';

const pages: DocPage[] = [
  {
    title: 'Server Loaders',
    route: '/docs/loaders',
    headings: [
      { text: 'How it works', id: 'how-it-works', depth: 2 },
      { text: 'Options', id: 'options', depth: 2 },
    ],
  },
  {
    title: 'Streaming',
    route: '/docs/streaming',
    headings: [{ text: 'Errors', id: 'errors', depth: 2 }],
  },
];

describe('fuzzyScore', () => {
  it('returns null when query is not a subsequence', () => {
    expect(fuzzyScore('loaders', 'xyz')).toBeNull();
  });
  it('scores a contiguous prefix higher than a scattered match', () => {
    const contiguous = fuzzyScore('options', 'opt')!;
    const scattered = fuzzyScore('open pretty things', 'opt')!;
    expect(contiguous).toBeGreaterThan(scattered);
  });
});

describe('searchDocs', () => {
  it('returns one result per page (title only) for an empty query', () => {
    const r = searchDocs(pages, '');
    expect(r).toEqual([
      { href: '/docs/loaders', title: 'Server Loaders' },
      { href: '/docs/streaming', title: 'Streaming' },
    ]);
  });

  it('matches page titles and ranks them above heading matches', () => {
    const r = searchDocs(pages, 'options');
    // "Options" heading on loaders should appear, linking to the anchor.
    const opt = r.find((x) => x.section === 'Options')!;
    expect(opt.href).toBe('/docs/loaders#options');
    expect(opt.title).toBe('Server Loaders');
  });

  it('matches headings across pages', () => {
    const r = searchDocs(pages, 'errors');
    expect(r[0]).toEqual({
      href: '/docs/streaming#errors',
      title: 'Streaming',
      section: 'Errors',
    });
  });

  it('returns nothing for an unmatched query', () => {
    expect(searchDocs(pages, 'zzz')).toEqual([]);
  });
});
