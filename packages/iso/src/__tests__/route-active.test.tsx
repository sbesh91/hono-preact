// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { matchPath } from '../route-active.js';

describe('matchPath', () => {
  it('exact-matches an identical literal path', () => {
    expect(matchPath('/docs', '/docs', true)).toEqual({});
  });

  it('returns null when the path differs', () => {
    expect(matchPath('/docs', '/about', true)).toBeNull();
  });

  it('captures params from a dynamic pattern', () => {
    expect(matchPath('/posts/123', '/posts/:id', true)).toEqual({ id: '123' });
  });

  it('does NOT match a descendant in exact mode', () => {
    expect(matchPath('/posts/123/edit', '/posts/:id', true)).toBeNull();
  });

  it('matches a descendant in non-exact mode', () => {
    expect(
      matchPath('/docs/components/dialog', '/docs/components', false)
    ).toEqual({});
  });

  it('matches the section root itself in non-exact mode', () => {
    expect(matchPath('/docs/components', '/docs/components', false)).toEqual(
      {}
    );
  });

  it('ignores a trailing slash on the route argument', () => {
    expect(matchPath('/docs', '/docs/', true)).toEqual({});
  });

  it('matches the root path only against itself', () => {
    expect(matchPath('/', '/', true)).toEqual({});
    expect(matchPath('/x', '/', true)).toBeNull();
  });

  it('matches any path in non-exact mode for the root route', () => {
    // `/` in non-exact mode is a universal ancestor: every path is a
    // descendant of root, so this is intentionally always-active.
    expect(matchPath('/anything', '/', false)).toEqual({});
  });

  it('supports a wildcard pattern', () => {
    expect(matchPath('/files/a/b', '/files/*', true)).toEqual({});
  });
});
