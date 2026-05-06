import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';
import { prefetch } from '../prefetch.js';

describe('prefetch', () => {
  it('derives pathParams from url + route', async () => {
    const ref = defineLoader(async ({ location }) => {
      return { id: location.pathParams.id };
    }, { __moduleKey: 'movie-by-id' });
    const result = await prefetch(ref, { url: '/movies/42', route: '/movies/:id' });
    expect(result).toEqual({ id: '42' });
  });

  it('derives searchParams from url query string', async () => {
    const ref = defineLoader(async ({ location }) => {
      return { q: location.searchParams.q };
    }, { __moduleKey: 'search-by-q' });
    const result = await prefetch(ref, { url: '/search?q=hi' });
    expect(result).toEqual({ q: 'hi' });
  });

  it('derives a clean path (no trailing slash, leading slash preserved)', async () => {
    const ref = defineLoader(async ({ location }) => {
      return { path: location.path };
    }, { __moduleKey: 'path-echo' });
    expect(await prefetch(ref, { url: '/movies/' })).toEqual({ path: '/movies' });
    expect(await prefetch(ref, { url: '/' })).toEqual({ path: '/' });
    expect(await prefetch(ref, { url: '/movies/42?x=1' })).toEqual({ path: '/movies/42' });
  });

  it('back-compat: location overrides url/route derivation', async () => {
    const ref = defineLoader(async ({ location }) => {
      return {
        path: location.path,
        id: location.pathParams.id,
        q: location.searchParams.q,
      };
    }, { __moduleKey: 'back-compat' });
    const result = await prefetch(ref, {
      url: '/should-be-ignored',
      route: '/should-be-ignored/:id',
      location: {
        path: '/explicit',
        pathParams: { id: 'X' },
        searchParams: { q: 'Y' },
      },
    });
    expect(result).toEqual({ path: '/explicit', id: 'X', q: 'Y' });
  });

  it('no-args call resolves with an empty but type-complete location', async () => {
    const ref = defineLoader(async ({ location }) => {
      return {
        path: location.path,
        pathParams: location.pathParams,
        searchParams: location.searchParams,
      };
    }, { __moduleKey: 'empty-loc' });
    const result = await prefetch(ref);
    expect(result).toEqual({ path: '', pathParams: {}, searchParams: {} });
  });
});
