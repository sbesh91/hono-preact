import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import { runRequestScope, getRequestHonoContext } from '../cache.js';
import { runLoader } from '../internal/loader-runner.js';
import { defineLoader } from '../define-loader.js';
import type { RouteHook } from 'preact-iso';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

describe('runLoader direct-fn path receives Hono Context via runRequestScope', () => {
  it('passes seeded c into LoaderCtx during SSR-style invocation', async () => {
    let observedC: unknown = null;
    const ref = defineLoader(async (ctx) => {
      observedC = ctx.c;
      return { ok: true };
    });
    const fakeC = { req: {}, header: () => {}, var: {} } as unknown as Context;

    await runRequestScope(
      () =>
        runLoader(ref, loc, 'id1', new AbortController().signal, {
          onChunk: () => {},
          onError: () => {},
          onEnd: () => {},
        }),
      { honoContext: fakeC }
    );

    expect(observedC).toBe(fakeC);
  });
});

describe('getRequestHonoContext contract', () => {
  it('returns undefined outside any runRequestScope (browser-like / no ALS path)', () => {
    expect(getRequestHonoContext()).toBeUndefined();
  });

  it('throws inside a runRequestScope that was not seeded with { honoContext }', async () => {
    await expect(
      runRequestScope(async () => {
        getRequestHonoContext();
      })
    ).rejects.toThrow(/runRequestScope is active but was not seeded/);
  });

  it('returns the seeded context when honoContext is passed to runRequestScope', async () => {
    const fakeC = { kind: 'fake' } as unknown as Context;
    const observed = await runRequestScope(
      async () => getRequestHonoContext<Context>(),
      { honoContext: fakeC },
    );
    expect(observed).toBe(fakeC);
  });
});
