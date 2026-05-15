import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import { runRequestScope } from '../cache.js';
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
