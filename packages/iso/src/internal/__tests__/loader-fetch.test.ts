// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchLoaderData } from '../loader-fetch.js';

const loc = { path: '/x', pathParams: {}, searchParams: {} };
const noopCbs = { onChunk: () => {}, onError: () => {}, onEnd: () => {} };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchLoaderData: separate module + loader args', () => {
  it('puts both module and loader into the request body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await fetchLoaderData(
      'pages/movie',
      'summary',
      { path: '/movies/1', pathParams: { id: '1' }, searchParams: {} },
      new AbortController().signal,
      noopCbs
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.module).toBe('pages/movie');
    expect(body.loader).toBe('summary');
  });
});

describe('fetchLoaderData: __redirect envelope', () => {
  it('calls window.location.assign and returns a never-settling promise when the response carries __redirect', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ __redirect: '/login' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const assignSpy = vi.fn();
    // happy-dom's window.location is read-only; replace just assign.
    Object.defineProperty(window.location, 'assign', {
      configurable: true,
      value: assignSpy,
    });

    const p = fetchLoaderData(
      'm',
      'default',
      loc,
      new AbortController().signal,
      noopCbs
    );
    // Race against a short timeout to confirm the promise does NOT settle.
    const result = await Promise.race([
      p,
      new Promise<'pending'>((r) => setTimeout(() => r('pending'), 20)),
    ]);
    expect(result).toBe('pending');
    expect(assignSpy).toHaveBeenCalledWith('/login');
  });

  it('returns the JSON value when the response is a plain object (not a __redirect)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ movies: [1, 2, 3] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const result = await fetchLoaderData(
      'm',
      'default',
      loc,
      new AbortController().signal,
      noopCbs
    );
    expect(result).toEqual({ movies: [1, 2, 3] });
  });
});
