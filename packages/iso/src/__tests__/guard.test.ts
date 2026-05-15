import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import {
  defineServerGuard,
  defineClientGuard,
  runServerGuards,
  runClientGuards,
  type ServerGuardFn,
  type ClientGuardFn,
} from '../guard.js';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const fakeC = {
  req: { header: () => undefined },
  header: () => {},
  var: {},
} as unknown as Context;

describe('defineServerGuard / defineClientGuard', () => {
  it('produces a record tagged with runs', () => {
    const g = defineServerGuard(async (_c, next) => next());
    expect(g.runs).toBe('server');
    expect(typeof g.fn).toBe('function');
  });

  it('defineClientGuard tags as client', () => {
    const g = defineClientGuard(async (_c, next) => next());
    expect(g.runs).toBe('client');
  });

  it('defineServerGuard callbacks receive a typed Hono Context as ctx.c', async () => {
    let observedC: unknown = undefined;
    const g = defineServerGuard(async (ctx, next) => {
      observedC = ctx.c;
      return next();
    });
    await runServerGuards([g], { c: fakeC, location: loc });
    expect(observedC).toBe(fakeC);
  });

  it('defineClientGuard callbacks have no c on their context', async () => {
    let keys: string[] = [];
    const g = defineClientGuard(async (ctx, next) => {
      keys = Object.keys(ctx);
      return next();
    });
    await runClientGuards([g], { location: loc });
    expect(keys).not.toContain('c');
    expect(keys).toContain('location');
  });
});

describe('runServerGuards composes records via .fn', () => {
  it('threads next() through each guard in order', async () => {
    const calls: string[] = [];
    const a: ServerGuardFn = defineServerGuard(async (_c, next) => {
      calls.push('a:before');
      const r = await next();
      calls.push('a:after');
      return r;
    });
    const b: ServerGuardFn = defineServerGuard(async (_c, next) => {
      calls.push('b');
      return next();
    });
    const result = await runServerGuards([a, b], { c: fakeC, location: loc });
    expect(result).toBeUndefined();
    expect(calls).toEqual(['a:before', 'b', 'a:after']);
  });

  it('short-circuits on the first non-void return', async () => {
    const a = defineServerGuard(async (_c, next) => next());
    const b = defineServerGuard(async () => ({ redirect: '/login' }));
    const c = defineServerGuard(async (_c, _next) => {
      throw new Error('should not run');
    });
    const result = await runServerGuards([a, b, c], { c: fakeC, location: loc });
    expect(result).toEqual({ redirect: '/login' });
  });
});

describe('runClientGuards composes records via .fn', () => {
  it('threads next() through each guard in order with no c', async () => {
    const calls: string[] = [];
    const a: ClientGuardFn = defineClientGuard(async (_ctx, next) => {
      calls.push('a:before');
      const r = await next();
      calls.push('a:after');
      return r;
    });
    const b: ClientGuardFn = defineClientGuard(async (_ctx, next) => {
      calls.push('b');
      return next();
    });
    const result = await runClientGuards([a, b], { location: loc });
    expect(result).toBeUndefined();
    expect(calls).toEqual(['a:before', 'b', 'a:after']);
  });

  it('short-circuits on the first non-void return', async () => {
    const a = defineClientGuard(async (_ctx, next) => next());
    const b = defineClientGuard(async () => ({ redirect: '/login' }));
    const c = defineClientGuard(async (_ctx, _next) => {
      throw new Error('should not run');
    });
    const result = await runClientGuards([a, b, c], { location: loc });
    expect(result).toEqual({ redirect: '/login' });
  });
});
