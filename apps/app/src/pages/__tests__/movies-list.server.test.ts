import { describe, it, expect } from 'vitest';
import { serverLoaders, type SearchResults } from '../movies-list.server.js';
import type { RouteHook } from 'preact-iso';

const listLoader = serverLoaders.default;

const locFor = (q?: string) =>
  ({
    path: '/movies',
    pathParams: {},
    searchParams: q == null ? {} : { q },
  } as unknown as RouteHook);

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe('movies-list loader (streaming search)', () => {
  it('yields a single list-mode chunk when q is empty', async () => {
    const ac = new AbortController();
    const gen = listLoader.fn({ location: locFor(), signal: ac.signal });
    const yields = await drain(gen as AsyncGenerator<SearchResults>);
    expect(yields).toHaveLength(1);
    expect(yields[0].mode).toBe('list');
  });

  it('yields 4 cumulative bucket chunks for a non-empty q', async () => {
    const ac = new AbortController();
    const gen = listLoader.fn({ location: locFor('moana'), signal: ac.signal });
    const yields = await drain(gen as AsyncGenerator<SearchResults>);
    expect(yields).toHaveLength(4);
    for (const y of yields) expect(y.mode).toBe('buckets');
    let prevTotal = 0;
    for (const y of yields) {
      if (y.mode !== 'buckets') continue;
      const total =
        y.buckets.exact.length +
        y.buckets.titleSubstring.length +
        y.buckets.overview.length +
        y.buckets.genre.length;
      expect(total).toBeGreaterThanOrEqual(prevTotal);
      prevTotal = total;
    }
  });

  it('throws after yielding once when q === "crash"', async () => {
    const ac = new AbortController();
    const gen = listLoader.fn({ location: locFor('crash'), signal: ac.signal });
    const yields: SearchResults[] = [];
    let err: Error | null = null;
    try {
      for await (const v of gen as AsyncGenerator<SearchResults>) yields.push(v);
    } catch (e) {
      err = e as Error;
    }
    expect(yields).toHaveLength(1);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/search index/i);
  });
});
