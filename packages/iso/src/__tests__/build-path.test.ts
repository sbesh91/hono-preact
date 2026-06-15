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
});
