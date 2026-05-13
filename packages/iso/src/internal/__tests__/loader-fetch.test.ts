import { describe, it, expect, vi } from 'vitest';
import { fetchLoaderData } from '../loader-fetch.js';

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
      { onChunk: () => {}, onError: () => {}, onEnd: () => {} }
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.module).toBe('pages/movie');
    expect(body.loader).toBe('summary');

    fetchSpy.mockRestore();
  });
});
