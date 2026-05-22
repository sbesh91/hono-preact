import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Context } from 'hono';
import { defineLoader } from '../define-loader.js';
import { defineServerMiddleware } from '../define-middleware.js';
import { runLoader } from '../internal/loader-runner.js';
import { runRequestScope } from '../cache.js';
import { env } from '../is-browser.js';

const fakeC = {
  req: { raw: { signal: new AbortController().signal } },
} as unknown as Context;

let originalEnv: typeof env.current;
beforeEach(() => {
  originalEnv = env.current;
  env.current = 'server';
});
afterEach(() => {
  env.current = originalEnv;
});

describe('loader middleware runs around the loader fn (SSR-inline path)', () => {
  it('wraps the loader call with before/after hooks', async () => {
    const calls: string[] = [];
    const wrapper = defineServerMiddleware<'loader'>(async (_ctx, next) => {
      calls.push('before');
      await next();
      calls.push('after');
    });

    const ref = defineLoader(
      async () => {
        calls.push('inner');
        return 'value';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [wrapper] }
    );

    const value = await runRequestScope(
      () =>
        runLoader(
          ref,
          { path: '/', pathParams: {}, searchParams: {} } as never,
          'test-id',
          new AbortController().signal,
          { onChunk: () => {}, onError: () => {}, onEnd: () => {} }
        ),
      { honoContext: fakeC }
    );

    expect(value).toBe('value');
    expect(calls).toEqual(['before', 'inner', 'after']);
  });

  it('a middleware that throws an outcome propagates the outcome', async () => {
    const blocker = defineServerMiddleware<'loader'>(async () => {
      const { redirect } = await import('../outcomes.js');
      throw redirect('/login');
    });

    const ref = defineLoader(async () => 'value', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [blocker],
    });

    await expect(
      runRequestScope(
        () =>
          runLoader(
            ref,
            { path: '/', pathParams: {}, searchParams: {} } as never,
            'test-id',
            new AbortController().signal,
            { onChunk: () => {}, onError: () => {}, onEnd: () => {} }
          ),
        { honoContext: fakeC }
      )
    ).rejects.toMatchObject({ __outcome: 'redirect', to: '/login' });
  });
});
