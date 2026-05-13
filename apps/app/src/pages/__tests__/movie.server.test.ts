import { describe, it, expect } from 'vitest';
import { serverLoaders, type DetailStream } from '../movie.server.js';
import type { RouteHook } from 'preact-iso';

const movieLoader = serverLoaders.default;

const locFor = (id: string, search: Record<string, string> = {}) =>
  ({
    path: `/movies/${id}`,
    pathParams: { id },
    searchParams: search,
  } as unknown as RouteHook);

describe('movie loader (unified streaming)', () => {
  it('first yield has movie/watched/watchedCount and empty streaming sections', async () => {
    const ac = new AbortController();
    const gen = movieLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const first = await (gen as AsyncGenerator<DetailStream>).next();
    expect(first.done).toBe(false);
    const v = first.value!;
    expect(v.movie).not.toBeNull();
    expect(v.summary).toBe('');
    expect(v.cast).toEqual([]);
    expect(v.similar).toEqual([]);
    expect(v.boxOffice).toBeNull();
    ac.abort();
    try { for await (const _ of gen as AsyncGenerator<DetailStream>) { /* drain */ } } catch { /* ignore */ }
  });

  it('streaming yields accumulate non-empty fields and eventually populate all four', async () => {
    const ac = new AbortController();
    const gen = movieLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    let last: DetailStream | undefined;
    for await (const v of gen as AsyncGenerator<DetailStream>) last = v;
    expect(last).toBeDefined();
    expect(last!.summary.length).toBeGreaterThan(0);
    expect(last!.cast.length).toBe(6);
    expect(last!.similar.length).toBe(4);
    expect(last!.boxOffice).not.toBeNull();
  }, 15_000);

  it('throws when searchParams.demo === "crash"', async () => {
    const ac = new AbortController();
    const gen = movieLoader.fn({
      location: locFor('1241982', { demo: 'crash' }),
      signal: ac.signal,
    });
    await expect(async () => {
      for await (const _ of gen as AsyncGenerator<DetailStream>) { /* drain */ }
    }).rejects.toThrow(/box-office/i);
  }, 15_000);

  it('respects signal.aborted (no yields after abort)', async () => {
    const ac = new AbortController();
    ac.abort();
    const gen = movieLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const first = await (gen as AsyncGenerator<DetailStream>).next();
    expect(first.done).toBe(true);
  });
});
