// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineLoader } from '../define-loader.js';
import { prefetch } from '../prefetch.js';

afterEach(() => vi.restoreAllMocks());

describe('prefetch (browser)', () => {
  it('POSTs to /__loaders instead of invoking ref.fn directly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '42' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    let fnInvoked = false;
    const ref = defineLoader(
      async ({ location }) => {
        fnInvoked = true;
        return { id: location.pathParams.id };
      },
      { __moduleKey: 'movie-by-id' }
    );

    const result = await prefetch(ref, {
      url: '/movies/42',
      route: '/movies/:id',
    });

    expect(fnInvoked).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/__loaders');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.module).toBe('movie-by-id');
    expect(body.loader).toBe('default');
    expect(body.location.pathParams).toEqual({ id: '42' });
    expect(result).toEqual({ id: '42' });
  });

  it('writes the RPC result into the loader cache keyed by the prefetched location', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ q: 'hi' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    // No params declared — cache key includes path only (no searchParam
    // dependency). The loader runtime will look up by the same key when
    // navigation actually mounts the loader.
    const ref = defineLoader(
      async ({ location }) => ({ q: location.searchParams.q }),
      { __moduleKey: 'search-by-q' }
    );
    await prefetch(ref, { url: '/search?q=hi' });
    expect(ref.cache?.get('/search?')).toEqual({ q: 'hi' });
  });

  it('is a no-op when the cache is already warm for this URL (hover repeats)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '42' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    // Unique __moduleKey isolates this test's cache from any other test in
    // this file. defineLoader caches live in a process-global Symbol.for
    // registry and persist across tests; sharing a module key would let
    // earlier tests pre-warm this one's cache.
    const ref = defineLoader<{ id: string }>(
      async ({ location }) => ({ id: location.pathParams.id }),
      { __moduleKey: 'prefetch-no-op-on-repeat' }
    );

    // First prefetch populates the cache.
    const first = await prefetch(ref, {
      url: '/movies/42',
      route: '/movies/:id',
    });
    expect(first).toEqual({ id: '42' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second prefetch for the SAME URL returns from cache, no network.
    const second = await prefetch(ref, {
      url: '/movies/42',
      route: '/movies/:id',
    });
    expect(second).toEqual({ id: '42' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does fetch when the URL changes (no false cache hit across distinct keys)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: '41' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: '42' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const ref = defineLoader<{ id: string }>(
      async ({ location }) => ({ id: location.pathParams.id }),
      { __moduleKey: 'movie-by-id-distinct' }
    );

    await prefetch(ref, { url: '/movies/41', route: '/movies/:id' });
    await prefetch(ref, { url: '/movies/42', route: '/movies/:id' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the loader name from the loaderRef (defaults to "default")', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const ref = defineLoader(async () => ({ ok: true }), {
      __moduleKey: 'mod',
      __loaderName: 'detail',
    });
    await prefetch(ref, { url: '/x' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.loader).toBe('detail');
  });
});
