import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { createCaller } from '../server-caller.js';
import { defineLoader } from '../define-loader.js';
import { defineAction } from '../action.js';
import { defineServerMiddleware } from '../define-middleware.js';
import { serverRoute } from '../server-route.js';
import { deny } from '../outcomes.js';

async function ctx() {
  const app = new Hono();
  let captured!: import('hono').Context;
  app.get('*', (c) => {
    captured = c;
    return c.text('ok');
  });
  // drive one request to mint a real Context (app.request returns Response | Promise<Response>)
  await app.request('http://localhost/');
  return captured;
}

describe('createCaller', () => {
  it('calls a loader and returns the authored T (no Serialize)', async () => {
    const c = await ctx();
    const movie = defineLoader(async () => ({
      title: 'Dune',
      seen: new Date(),
    }));
    const r = await createCaller(c).call(movie);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.seen).toBeInstanceOf(Date);
  });

  it('validates loader params and short-circuits to a deny outcome', async () => {
    const c = await ctx();
    const loader = defineLoader(async () => 1, {
      searchSchema: z.object({ n: z.coerce.number() }),
    });
    const r = await createCaller(c).call(loader, {
      location: { searchParams: { n: 'not-a-number' } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.__outcome).toBe('deny');
  });

  it('coerces valid loader params and returns the value (success path)', async () => {
    const c = await ctx();
    const loader = defineLoader(
      async (lc) => ({ n: lc.location.searchParams.n }),
      { searchSchema: z.object({ n: z.coerce.number() }) }
    );
    const r = await createCaller(c).call(loader, {
      location: { searchParams: { n: '42' } },
    });
    expect(r.ok).toBe(true);
    // `z.coerce.number()` ran: the loader saw the coerced number, not the string.
    if (r.ok) expect(r.value).toEqual({ n: 42 });
  });

  it('calls an action with a payload and runs its own middleware', async () => {
    const c = await ctx();
    const guard = {
      __kind: 'middleware' as const,
      runs: 'server' as const,
      fn: async () => deny('FORBIDDEN'),
    };
    const act = defineAction(
      async (_c, p: { x: number }) => ({ doubled: p.x * 2 }),
      {
        use: [guard],
      }
    );
    const r = await createCaller(c).call(act, { x: 21 });
    expect(r.ok).toBe(false);
    if (!r.ok && r.outcome.__outcome === 'deny')
      expect(r.outcome.code).toBe('FORBIDDEN');
  });

  it('runs an action handler when middleware passes', async () => {
    const c = await ctx();
    const act = defineAction(async (_c, p: { x: number }) => ({
      doubled: p.x * 2,
    }));
    const r = await createCaller(c).call(act, { x: 21 });
    expect(r).toEqual({ ok: true, value: { doubled: 42 } });
  });
});

describe('ctx.call composition', () => {
  it('lets a loader call another loader via ctx.call', async () => {
    const c = await ctx();
    const inner = defineLoader(async () => ({ n: 2 }));
    const outer = defineLoader(async (lc) => {
      const r = await lc.call(inner);
      return { doubled: (r.ok ? r.value.n : 0) * 2 };
    });
    const r = await createCaller(c).call(outer);
    expect(r).toEqual({ ok: true, value: { doubled: 4 } });
  });

  // The loader-side twin of the action middleware test above: ctx.call runs a
  // loader's own unit `use`. (Only the action side was covered before.)
  it("runs a loader's own unit middleware (a deny short-circuits before the loader body)", async () => {
    const c = await ctx();
    let loaderRan = false;
    const guard = defineServerMiddleware(async () => deny('FORBIDDEN'));
    const loader = defineLoader(
      async () => {
        loaderRan = true;
        return 1;
      },
      { use: [guard] }
    );
    const r = await createCaller(c).call(loader);
    expect(r.ok).toBe(false);
    if (!r.ok && r.outcome.__outcome === 'deny')
      expect(r.outcome.code).toBe('FORBIDDEN');
    expect(loaderRan).toBe(false); // guard short-circuited; the body never ran
  });

  // Locks the unit-tier composition order: the `use` chain wraps the loader
  // body outer-first, each middleware unwinding in reverse.
  it("runs a loader's unit `use` chain in declared order around the loader body", async () => {
    const c = await ctx();
    const order: string[] = [];
    const trace = (tag: string) =>
      defineServerMiddleware(async (_lc, next) => {
        order.push(`${tag}:before`);
        await next();
        order.push(`${tag}:after`);
      });
    const loader = defineLoader(
      async () => {
        order.push('loader');
        return 7;
      },
      { use: [trace('a'), trace('b')] }
    );
    const r = await createCaller(c).call(loader);
    expect(r).toEqual({ ok: true, value: 7 });
    expect(order).toEqual([
      'a:before',
      'b:before',
      'loader',
      'b:after',
      'a:after',
    ]);
  });

  // The route-tier-skip invariant. A route-bound loader's page-layer `use`
  // chain is resolved from its route pattern ONLY by the HTTP loader handler
  // (byPattern __routeId). createCaller takes just a Context and has no
  // page-use resolver, so a route node's page middleware is never composed
  // here: a route-bound loader runs identically to a bare one through ctx.call,
  // executing only its own unit `use`. (The page-tier skip itself is not
  // directly observable through createCaller's surface, which has no way to
  // register a page guard; this locks the observable half + the unit-use run.)
  it("runs only a route-bound loader's own unit `use` (ctx.call composes no page/app tier)", async () => {
    const c = await ctx();
    let loaderRan = false;
    const guard = defineServerMiddleware(async () => deny('FORBIDDEN'));
    const loader = serverRoute('/x').loader(
      async () => {
        loaderRan = true;
        return 1;
      },
      { use: [guard] }
    );
    const r = await createCaller(c).call(loader);
    expect(r.ok).toBe(false); // the unit guard still runs
    if (!r.ok && r.outcome.__outcome === 'deny')
      expect(r.outcome.code).toBe('FORBIDDEN');
    expect(loaderRan).toBe(false);
  });
});
