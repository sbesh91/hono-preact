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
});
