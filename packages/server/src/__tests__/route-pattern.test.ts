import { describe, it, expect } from 'vitest';
import {
  urlPathMatchesPattern,
  patternScore,
  findBestPattern,
} from '../route-pattern.js';

describe('urlPathMatchesPattern', () => {
  it('matches literal segments exactly', () => {
    expect(urlPathMatchesPattern('/a/b', '/a/b')).toBe(true);
    expect(urlPathMatchesPattern('/a/c', '/a/b')).toBe(false);
  });

  it('matches :param segments against any value', () => {
    expect(urlPathMatchesPattern('/users/42', '/users/:id')).toBe(true);
    expect(urlPathMatchesPattern('/users', '/users/:id')).toBe(false);
  });

  it('requires equal segment counts absent a wildcard', () => {
    expect(urlPathMatchesPattern('/a/b/c', '/a/b')).toBe(false);
    expect(urlPathMatchesPattern('/a', '/a/b')).toBe(false);
  });

  it('a trailing * matches any remainder including none', () => {
    expect(urlPathMatchesPattern('/docs/a/b', '/docs/*')).toBe(true);
    expect(urlPathMatchesPattern('/docs', '/docs/*')).toBe(true);
  });

  it('ignores leading/trailing slashes via segment comparison', () => {
    expect(urlPathMatchesPattern('/a/b/', '/a/b')).toBe(true);
    expect(urlPathMatchesPattern('a/b', '/a/b')).toBe(true);
  });

  it('a mid-pattern * matches the remainder; later segments are ignored', () => {
    // Inherited characterization: the matcher returns true on the first *,
    // wherever it appears. Generated route tables only emit trailing *.
    expect(urlPathMatchesPattern('/a/x/c', '/a/*/b')).toBe(true);
  });

  it('treats the empty pattern like the root pattern', () => {
    expect(urlPathMatchesPattern('/', '')).toBe(true);
  });

  it('matches a trailing optional :param? whether or not the URL supplies it', () => {
    // Regression: the server matcher must agree with preact-iso's exec, which
    // treats a trailing optional param as matchable when omitted. Disagreeing
    // here resolves a param-absent URL to no pattern, dropping server guards.
    expect(urlPathMatchesPattern('/files', '/files/:id?')).toBe(true);
    expect(urlPathMatchesPattern('/files/42', '/files/:id?')).toBe(true);
    // an extra segment beyond the optional param still does not match
    expect(urlPathMatchesPattern('/files/42/extra', '/files/:id?')).toBe(false);
  });

  it('matches :param* (rest, zero-or-more) including an empty remainder', () => {
    expect(urlPathMatchesPattern('/docs', '/docs/:rest*')).toBe(true);
    expect(urlPathMatchesPattern('/docs/a/b', '/docs/:rest*')).toBe(true);
  });

  it('matches :param+ (rest, one-or-more) only with at least one segment', () => {
    expect(urlPathMatchesPattern('/docs/a', '/docs/:rest+')).toBe(true);
    expect(urlPathMatchesPattern('/docs/a/b', '/docs/:rest+')).toBe(true);
    expect(urlPathMatchesPattern('/docs', '/docs/:rest+')).toBe(false);
  });
});

describe('patternScore', () => {
  it('scores literal=2, param=1, wildcard=0 per segment', () => {
    expect(patternScore('/a/b')).toBe(4);
    expect(patternScore('/a/:id')).toBe(3);
    expect(patternScore('/a/*')).toBe(2);
    expect(patternScore('/')).toBe(0);
  });
});

describe('findBestPattern', () => {
  it('returns null when nothing matches', () => {
    expect(findBestPattern(['/a', '/b'], '/c')).toBeNull();
  });

  it('prefers higher specificity: literal beats param at the same depth', () => {
    expect(
      findBestPattern(
        ['/admin/users/:id', '/admin/users/me'],
        '/admin/users/me'
      )
    ).toBe('/admin/users/me');
  });

  it('prefers depth when scores tie', () => {
    // Both match '/a/b/c' with score 2 ('/a/*' = 2+0; '/:a/:b/*' = 1+1+0);
    // the deeper pattern wins regardless of iteration order.
    expect(findBestPattern(['/a/*', '/:a/:b/*'], '/a/b/c')).toBe('/:a/:b/*');
    expect(findBestPattern(['/:a/:b/*', '/a/*'], '/a/b/c')).toBe('/:a/:b/*');
  });

  it('keeps the first-seen pattern when score and depth both tie', () => {
    expect(findBestPattern(['/x/:a', '/:x/a'], '/x/a')).toBe('/x/:a');
    expect(findBestPattern(['/:x/a', '/x/:a'], '/x/a')).toBe('/:x/a');
  });

  it('accepts any iterable of patterns (Map keys)', () => {
    const m = new Map([
      ['/p/:id', 1],
      ['/p/new', 2],
    ]);
    expect(findBestPattern(m.keys(), '/p/new')).toBe('/p/new');
  });

  it('score is primary across different depths', () => {
    // '/a/b' (score 4, depth 2) beats '/a/:x/*' (score 3, depth 3).
    expect(findBestPattern(['/a/b', '/a/:x/*'], '/a/b')).toBe('/a/b');
  });

  it('resolves a param-absent URL to a trailing-optional route (guard-bypass regression)', () => {
    // /files/:id? must resolve for /files, not fall through to null (which the
    // action/use resolvers translate into an empty guard set).
    expect(findBestPattern(['/files/:id?'], '/files')).toBe('/files/:id?');
    expect(findBestPattern(['/files/:id?'], '/files/42')).toBe('/files/:id?');
  });

  it('the catch-all outranks the root pattern at the root URL', () => {
    // Inherited characterization: '/' and '/*' both score 0 for '/', and
    // the catch-all's depth 1 beats root's depth 0. Pinned so a future
    // matcher rewrite cannot flip it silently.
    expect(findBestPattern(['/', '/*'], '/')).toBe('/*');
  });
});
