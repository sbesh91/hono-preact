import { describe, it, expect } from 'vitest';
import { joinRoutePath, commonDirPrefix, defaultSlug } from '../contract.js';

/**
 * These three are the shared route-path rules: the runtime registers patterns
 * with them (`define-routes.tsx`, `content-routes.tsx`) and the build-time
 * route scan derives its preload keys with them (`vite/route-preload.ts`). They
 * were byte-for-byte copies in both packages until #324; now that one source
 * feeds both, their edges are worth pinning directly rather than only through
 * whichever caller happens to exercise them.
 */

describe('joinRoutePath', () => {
  it('passes the other side through when either is empty', () => {
    // Bare-grouping parents use '' so they contribute no URL segment.
    expect(joinRoutePath('', 'about')).toBe('about');
    expect(joinRoutePath('/docs', '')).toBe('/docs');
    expect(joinRoutePath('', '')).toBe('');
  });

  it('never doubles the separator under a root parent', () => {
    expect(joinRoutePath('/', 'about')).toBe('/about');
    expect(joinRoutePath('/', '/about')).toBe('/about');
  });

  it('joins nested segments with a single slash', () => {
    expect(joinRoutePath('/docs', 'styling')).toBe('/docs/styling');
    expect(joinRoutePath('/a', 'b')).toBe('/a/b');
  });
});

describe('commonDirPrefix', () => {
  it('is empty for no keys and for keys sharing no directory', () => {
    expect(commonDirPrefix([])).toBe('');
    expect(commonDirPrefix(['docs/a.mdx', 'blog/b.mdx'])).toBe('');
  });

  it('returns the shared directory, ending at a slash', () => {
    expect(commonDirPrefix(['docs/a.mdx', 'docs/b.mdx'])).toBe('docs/');
    expect(commonDirPrefix(['docs/g/a.mdx', 'docs/g/b.mdx'])).toBe('docs/g/');
  });

  it('never treats a partial segment as a directory', () => {
    // 'docs' and 'docsite' share the characters 'docs', but not a directory.
    // Stopping at the last slash is what prevents a truncated base.
    expect(commonDirPrefix(['docs/a.mdx', 'docsite/b.mdx'])).toBe('');
    expect(commonDirPrefix(['x/docs/a.mdx', 'x/docsite/b.mdx'])).toBe('x/');
  });

  it('is the key itself, to its last slash, for a single key', () => {
    expect(commonDirPrefix(['docs/guide/a.mdx'])).toBe('docs/guide/');
  });
});

describe('defaultSlug', () => {
  it('strips the base prefix and the final extension', () => {
    expect(defaultSlug('docs/styling.mdx', 'docs/')).toBe('styling');
  });

  it('strips a trailing index segment', () => {
    // The regex consumes the separator with the segment, so the result has no
    // trailing slash: 'guide/index' -> 'guide', not 'guide/'.
    expect(defaultSlug('docs/guide/index.mdx', 'docs/')).toBe('guide');
    expect(defaultSlug('docs/index.mdx', 'docs/')).toBe('');
  });

  it('leaves a key that does not start with the base alone', () => {
    expect(defaultSlug('other/a.mdx', 'docs/')).toBe('other/a');
  });

  it('strips only the final extension', () => {
    expect(defaultSlug('docs/a.b.mdx', 'docs/')).toBe('a.b');
  });
});
