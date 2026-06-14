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

describe('fetchLoaderData: redirect outcome envelope', () => {
  it('calls window.location.assign and returns a never-settling promise when the response carries a redirect outcome', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ __outcome: 'redirect', to: '/login', status: 302 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
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

  it('returns the JSON value when the response is a plain object (not a redirect outcome)', async () => {
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

describe('fetchLoaderData: deny outcome envelope', () => {
  it('throws an Error with the deny message when the envelope carries one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ __outcome: 'deny', message: 'Forbidden' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    await expect(
      fetchLoaderData(
        'm',
        'default',
        loc,
        new AbortController().signal,
        noopCbs
      )
    ).rejects.toThrow('Forbidden');
  });

  it('falls back to a deny-aware label when the envelope lacks a message', async () => {
    // Defense in depth: deny() now defaults the message at construction time,
    // but a hand-rolled envelope (custom server middleware) could still ship
    // without one. The client should still surface the deny intent rather
    // than the generic "Loader failed with status N".
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ __outcome: 'deny' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(
      fetchLoaderData(
        'm',
        'default',
        loc,
        new AbortController().signal,
        noopCbs
      )
    ).rejects.toThrow(/Request denied \(403\)/);
  });

  it('falls back to the legacy { error } shape for non-deny error responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(
      fetchLoaderData(
        'm',
        'default',
        loc,
        new AbortController().signal,
        noopCbs
      )
    ).rejects.toThrow('boom');
  });

  it('uses the generic loader-failure message with remediation when the body has no error field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(
      fetchLoaderData(
        'm',
        'default',
        loc,
        new AbortController().signal,
        noopCbs
      )
    ).rejects.toThrow(
      "Loader failed with status 503. Check the loader's .server.ts for a thrown error, and the server logs for details."
    );
  });
});
