import { describe, it, expect } from 'vitest';
import { buildPath } from '../build-path.js';

describe('buildPath', () => {
  it('substitutes a single param', () => {
    expect(buildPath('/posts/:id', { id: '123' })).toBe('/posts/123');
  });

  it('substitutes multiple params', () => {
    expect(
      buildPath('/demo/projects/:projectId/issues/:issueId', {
        projectId: 'p1',
        issueId: 'i9',
      })
    ).toBe('/demo/projects/p1/issues/i9');
  });

  it('needs no params object for a param-less route', () => {
    expect(buildPath('/docs/components')).toBe('/docs/components');
  });

  it('keeps an optional param when provided', () => {
    expect(buildPath('/files/:id?', { id: 'x' })).toBe('/files/x');
  });

  it('drops an absent optional param segment', () => {
    expect(buildPath('/files/:id?', {})).toBe('/files');
  });

  it('drops a segment whose value is an empty string', () => {
    expect(buildPath('/files/:id?', { id: '' })).toBe('/files');
  });

  it('percent-encodes substituted values', () => {
    expect(buildPath('/search/:q', { q: 'a b/c' })).toBe('/search/a%20b%2Fc');
  });

  it('returns the root path unchanged', () => {
    expect(buildPath('/')).toBe('/');
  });

  // A `:name` whose name falls outside `[A-Za-z0-9_]` (e.g. a hyphen) is not a
  // param: the matcher keeps the segment verbatim. The type agrees
  // (`RouteParams<'/x/:foo-bar'>` is `{}`), so no params object is required —
  // before that alignment this call would not have compiled. See typed-routes
  // `IsParamName` and typed-routes.test-d.ts.
  it('keeps a hyphenated :param segment verbatim (it is a literal, not a param)', () => {
    expect(buildPath('/x/:foo-bar')).toBe('/x/:foo-bar');
  });

  it('substitutes a valid sibling param while keeping a hyphenated literal', () => {
    expect(buildPath('/x/:foo-bar/y/:id', { id: '7' })).toBe('/x/:foo-bar/y/7');
  });

  // (regression) a params value supplied via a PROTOTYPE getter (not an own
  // property) must still substitute. `Object.hasOwn` -- an earlier gate --
  // only sees own properties, so it dropped a getter-provided value and
  // buildPath silently truncated the path.
  it('substitutes a param value supplied via a prototype getter', () => {
    class WithGetterId {
      get id() {
        return '1';
      }
    }
    expect(buildPath('/user/:id', new WithGetterId())).toBe('/user/1');
  });

  // (regression) a NUMERIC param value must coerce and substitute, not drop.
  // A `typeof value === 'string'` gate wrongly dropped numbers; the `!value ||
  // typeof value === 'function'` gate keeps a number (coerced by
  // encodeURIComponent), matching the pre-hardening behavior. A JS caller can
  // pass a number even though the type is `string`.
  it('coerces and substitutes a numeric param value', () => {
    expect(
      buildPath('/posts/:id', { id: 123 } as unknown as { id: string })
    ).toBe('/posts/123');
  });

  // (regression) numeric 0 is a real, distinct value and must NOT be dropped:
  // a `!value` gate treated 0 as absent and collapsed '/posts/0' to '/posts'.
  it('keeps a numeric 0 param value rather than dropping the segment', () => {
    expect(
      buildPath('/posts/:id', { id: 0 } as unknown as { id: string })
    ).toBe('/posts/0');
  });
});
