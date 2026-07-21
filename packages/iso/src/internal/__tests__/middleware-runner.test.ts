import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Context } from 'hono';
import {
  defineServerMiddleware,
  defineClientMiddleware,
  type Next,
} from '../../define-middleware.js';
import {
  dispatch,
  dispatchServer,
  dispatchClient,
  type DispatchResult,
} from '../middleware-runner.js';
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

  it('middle-mw outcome short-circuits inner but lets outer after-block run', async () => {
    // Simulates root -> page -> unit ordering: when the page-layer middleware
    // throws an outcome before calling next(), the unit middleware and inner
    // body must not run, but the root middleware's after-block must still
    // execute (so cleanup like timing/logging fires).
    const calls: string[] = [];
    const root = defineServerMiddleware(async (_ctx, next) => {
      calls.push('root:before');
      try {
        await next();
        calls.push('root:after-ok');
      } catch (e) {
        // Re-throw the outcome so the dispatcher can translate it; record
        // that we ran the after-block on the error path.
        calls.push('root:after-outcome');
        throw e;
      }
    });
    const page = defineServerMiddleware(async () => {
      calls.push('page:before-throw');
      throw deny(403, 'nope');
    });
    const unit = defineServerMiddleware(async (_ctx, next) => {
      calls.push('unit:before');
      await next();
      calls.push('unit:after');
    });

    const result = await dispatchServer({
      middleware: [root, page, unit],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => {
        calls.push('inner');
        return 'unreached';
      },
    });

    expect(result.kind).toBe('outcome');
    if (result.kind === 'outcome') {
      expect(result.outcome.__outcome).toBe('deny');
    }
    expect(calls).toEqual([
      'root:before',
      'page:before-throw',
      'root:after-outcome',
    ]);
    // Belt-and-suspenders: unit middleware and the inner body must NOT
    // appear anywhere in the call log.
    expect(calls).not.toContain('unit:before');
    expect(calls).not.toContain('unit:after');
    expect(calls).not.toContain('inner');
  });

  it('detects double-next() and throws a structured error', async () => {
    const bad = defineServerMiddleware(async (_ctx, next) => {
      await next();
      await next();
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
    ).rejects.toThrow(/called next\(\) more than once/);
  });

  it('rethrows a non-outcome error thrown from inner via the mw chain', async () => {
    // Existing tests cover deny thrown from inner; this asserts a generic
    // Error from inner propagates through outer middleware without being
    // swallowed or coerced.
    const outer = defineServerMiddleware(async (_ctx, next) => {
      await next();
    });
    await expect(
      dispatchServer({
        middleware: [outer],
        ctx: {
          scope: 'loader',
          c: fakeC,
          signal,
          location: { path: '/' } as never,
          module: 'm',
          loader: 'l',
        },
        inner: async () => {
          throw new Error('inner-boom');
        },
      })
    ).rejects.toThrow('inner-boom');
  });
});

describe('dispatch — generic engine (Ctx-agnostic)', () => {
  it('runs arbitrary {fn} middleware in order around inner and threads the value', async () => {
    const calls: string[] = [];
    const mk = (id: string) => ({
      fn: async (_ctx: { n: number }, next: Next) => {
        calls.push(`${id}:before`);
        await next();
        calls.push(`${id}:after`);
      },
    });
    const result = await dispatch<{ n: number }, string>({
      middleware: [mk('a'), mk('b')],
      ctx: { n: 1 },
      inner: async () => 'inner',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toBe('inner');
    expect(calls).toEqual(['a:before', 'b:before', 'b:after', 'a:after']);
  });

  it('short-circuits on a thrown outcome', async () => {
    const result = await dispatch<{ n: number }, string>({
      middleware: [
        {
          fn: async () => {
            throw deny(403, 'no');
          },
        },
      ],
      ctx: { n: 1 },
      inner: async () => 'unreached',
    });
    expect(result.kind).toBe('outcome');
    if (result.kind === 'outcome') {
      expect(result.outcome.__outcome).toBe('deny');
    }
  });
});

describe('dispatchClient — facade over dispatch', () => {
  it('runs client middleware around inner and returns the value (closes the previously-untested client path)', async () => {
    const calls: string[] = [];
    const mw = defineClientMiddleware(async (_ctx, next) => {
      calls.push('c:before');
      await next();
      calls.push('c:after');
    });
    const result: DispatchResult<string> = await dispatchClient({
      middleware: [mw],
      ctx: { scope: 'page', location: { path: '/' } as never },
      inner: async () => 'client-value',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toBe('client-value');
    expect(calls).toEqual(['c:before', 'c:after']);
  });

  it('catches a thrown outcome from client middleware', async () => {
    const mw = defineClientMiddleware(async () => {
      throw redirect('/login');
    });
    const result = await dispatchClient({
      middleware: [mw],
      ctx: { scope: 'page', location: { path: '/' } as never },
      inner: async () => 'unreached',
    });
    expect(result.kind).toBe('outcome');
    if (result.kind === 'outcome') {
      expect(result.outcome.__outcome).toBe('redirect');
    }
  });
});

describe('dispatchServer — signal', () => {
  it('AbortSignal aborted mid-chain does not short-circuit (by design)', async () => {
    // The dispatcher intentionally does not read ctx.signal: cancellation is
    // the inner function's responsibility (loaders/actions check signal in
    // their own body). This test pins that behavior so a future change to
    // make the dispatcher signal-aware is an explicit decision.
    const controller = new AbortController();
    const calls: string[] = [];
    const mw = defineServerMiddleware(async (_ctx, next) => {
      calls.push('mw:before');
      controller.abort();
      await next();
      calls.push('mw:after');
    });
    const result = await dispatchServer({
      middleware: [mw],
      ctx: {
        scope: 'loader',
        c: fakeC,
        signal: controller.signal,
        location: { path: '/' } as never,
        module: 'm',
        loader: 'l',
      },
      inner: async () => {
        calls.push('inner');
        return 'value';
      },
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toBe('value');
    expect(calls).toEqual(['mw:before', 'inner', 'mw:after']);
  });
});

// Both contract violations always throw; only the explanation is gated so it
// tree-shakes out of a production client bundle (see the comment on dispatch).
// The terse branch is pinned so it cannot rot untested.
describe('contract-violation message gating', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const callsNextTwice = {
    fn: async (_ctx: unknown, next: Next) => {
      await next();
      await next();
    },
  };
  const neverCallsNext = { fn: async () => undefined };
  const run = (mw: { fn: (ctx: unknown, next: Next) => Promise<unknown> }) =>
    dispatch({
      middleware: [mw as never],
      ctx: {} as never,
      inner: async () => 'x',
    });

  it('explains on the server, in every mode', async () => {
    vi.stubEnv('SSR', true);
    vi.stubEnv('DEV', false);
    await expect(run(callsNextTwice)).rejects.toThrow(
      /called next\(\) more than once\. Each middleware must call next\(\) exactly once/
    );
    await expect(run(neverCallsNext)).rejects.toThrow(
      /Returning silently is ambiguous/
    );
  });

  it('still throws in a client production build, tersely', async () => {
    vi.stubEnv('SSR', false);
    vi.stubEnv('DEV', false);
    await expect(run(callsNextTwice)).rejects.toThrow(
      /^Middleware at index 0 called next\(\) more than once\.$/
    );
    await expect(run(neverCallsNext)).rejects.toThrow(
      /^Middleware at index 0 returned without calling next\(\)\.$/
    );
  });
});
