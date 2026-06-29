import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { createCaller } from '../server-caller.js';
import { defineLoader } from '../define-loader.js';
import { defineAction } from '../action.js';
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
    const movie = defineLoader(async () => ({ title: 'Dune', seen: new Date() }));
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
    const act = defineAction(async (_c, p: { x: number }) => ({ doubled: p.x * 2 }), {
      use: [guard],
    });
    const r = await createCaller(c).call(act, { x: 21 });
    expect(r.ok).toBe(false);
    if (!r.ok && r.outcome.__outcome === 'deny') expect(r.outcome.code).toBe('FORBIDDEN');
  });

  it('runs an action handler when middleware passes', async () => {
    const c = await ctx();
    const act = defineAction(async (_c, p: { x: number }) => ({ doubled: p.x * 2 }));
    const r = await createCaller(c).call(act, { x: 21 });
    expect(r).toEqual({ ok: true, value: { doubled: 42 } });
  });
});
