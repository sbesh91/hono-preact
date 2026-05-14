import { describe, it, expect } from 'vitest';
import type { RouteHook } from 'preact-iso';
import {
  defineServerGuard,
  defineClientGuard,
  runGuards,
  type GuardFn,
} from '../guard.js';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

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
});

describe('runGuards composes records via .fn', () => {
  it('threads next() through each guard in order', async () => {
    const calls: string[] = [];
    const a: GuardFn = defineServerGuard(async (_c, next) => {
      calls.push('a:before');
      const r = await next();
      calls.push('a:after');
      return r;
    });
    const b: GuardFn = defineServerGuard(async (_c, next) => {
      calls.push('b');
      return next();
    });
    const result = await runGuards([a, b], { location: loc });
    expect(result).toBeUndefined();
    expect(calls).toEqual(['a:before', 'b', 'a:after']);
  });

  it('short-circuits on the first non-void return', async () => {
    const a = defineServerGuard(async (_c, next) => next());
    const b = defineServerGuard(async () => ({ redirect: '/login' }));
    const c = defineServerGuard(async (_c, _next) => {
      throw new Error('should not run');
    });
    const result = await runGuards([a, b, c], { location: loc });
    expect(result).toEqual({ redirect: '/login' });
  });
});
