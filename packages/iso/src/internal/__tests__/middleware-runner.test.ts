import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import { defineServerMiddleware } from '../../define-middleware.js';
import { dispatchServer, type DispatchResult } from '../middleware-runner.js';
import { redirect, deny, isOutcome } from '../../outcomes.js';

const fakeC = { req: { header: () => undefined } } as unknown as Context;
const signal = new AbortController().signal;

describe('dispatchServer — basic chain', () => {
  it('runs middleware in array order around the inner function', async () => {
    const calls: string[] = [];
    const a = defineServerMiddleware(async (_ctx, next) => {
      calls.push('a:before');
      await next();
      calls.push('a:after');
    });
    const b = defineServerMiddleware(async (_ctx, next) => {
      calls.push('b:before');
      await next();
      calls.push('b:after');
    });

    const result: DispatchResult<string> = await dispatchServer({
      middleware: [a, b],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => 'inner-value',
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toBe('inner-value');
    expect(calls).toEqual(['a:before', 'b:before', 'b:after', 'a:after']);
  });

  it('returns inner result when no middleware is attached', async () => {
    const result = await dispatchServer({
      middleware: [],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => 42,
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toBe(42);
  });
});

describe('dispatchServer — outcomes', () => {
  it('catches a thrown redirect and returns it as outcome result', async () => {
    const mw = defineServerMiddleware(async () => {
      throw redirect('/login');
    });
    const result = await dispatchServer({
      middleware: [mw],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => 'unreached',
    });
    expect(result.kind).toBe('outcome');
    if (result.kind === 'outcome') {
      expect(result.outcome.__outcome).toBe('redirect');
    }
  });

  it('catches a thrown deny from the inner function', async () => {
    const result = await dispatchServer({
      middleware: [],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => {
        throw deny(403, 'No');
      },
    });
    expect(result.kind).toBe('outcome');
    if (result.kind === 'outcome') {
      expect(result.outcome.__outcome).toBe('deny');
    }
  });

  it('rethrows non-outcome errors', async () => {
    const mw = defineServerMiddleware(async () => {
      throw new Error('boom');
    });
    await expect(
      dispatchServer({
        middleware: [mw],
        ctx: {
          scope: 'loader',
          c: fakeC,
          signal,
          location: { path: '/' } as never,
          module: 'm',
          loader: 'l',
        },
        inner: async () => 'x',
      })
    ).rejects.toThrow('boom');
  });

  it('detects forgotten-next() and throws a structured error', async () => {
    const bad = defineServerMiddleware(async () => {
      // returns without calling next() and without throwing an outcome
    });
    await expect(
      dispatchServer({
        middleware: [bad],
        ctx: {
          scope: 'loader',
          c: fakeC,
          signal,
          location: { path: '/' } as never,
          module: 'm',
          loader: 'l',
        },
        inner: async () => 'x',
      })
    ).rejects.toThrow(/next\(\) or short-circuiting/);
  });

  it('outer middleware can catch an inner outcome and re-emit a different one', async () => {
    const outer = defineServerMiddleware(async (_ctx, next) => {
      try {
        await next();
      } catch (e) {
        if (isOutcome(e) && e.__outcome === 'deny') {
          throw redirect('/login');
        }
        throw e;
      }
    });
    const inner = defineServerMiddleware(async () => {
      throw deny(403);
    });

    const result = await dispatchServer({
      middleware: [outer, inner],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => 'unreached',
    });

    expect(result.kind).toBe('outcome');
    if (result.kind === 'outcome') {
      expect(result.outcome.__outcome).toBe('redirect');
    }
  });
});
