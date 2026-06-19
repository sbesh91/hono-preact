// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LoaderCtx } from 'hono-preact';
import { serverLoaders } from '../projects-shell.server.js';

afterEach(() => vi.restoreAllMocks());

// Resolves true if `p` is still pending after a few microtask ticks (long enough
// for the generator's synchronous backfill yields to settle, but not for the
// real setTimeout it parks on).
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol();
  const ticks = Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => marker);
  const result = await Promise.race([p.then(() => false), ticks]);
  return result === marker;
}

describe('activityStream timer cleanup', () => {
  it('clears the pending wait timer when the request aborts (no dangling setTimeout)', async () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    const ctrl = new AbortController();
    const ctx = {
      c: {},
      location: { path: '/', pathParams: {}, searchParams: {} },
      signal: ctrl.signal,
    } as unknown as LoaderCtx;

    // `.fn` is the activityStream generator (Loader<T> is a union of fn shapes).
    const fn = serverLoaders.activity.fn as (
      ctx: LoaderCtx
    ) => AsyncGenerator<unknown, void, unknown>;
    const gen = fn(ctx);

    // Drain the synchronous recent-events backfill until the generator parks on
    // the wait race (`Promise.race([wake, setTimeout])`).
    let parked: Promise<IteratorResult<unknown>> | null = null;
    for (let i = 0; i < 12; i++) {
      const np = gen.next();
      if (await isPending(np)) {
        parked = np;
        break;
      }
    }
    expect(parked).not.toBeNull();
    // A wait timer is now pending and was not yet cleared.
    expect(setSpy).toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();

    // Abort: the generator wakes, clears the pending timer, and unwinds via finally.
    ctrl.abort();
    await parked;

    expect(clearSpy).toHaveBeenCalled();
  });
});
