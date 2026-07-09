import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { h } from 'preact';
import { z } from 'zod';
import { pageActionsHandler } from '../page-actions-handler.js';
import { loadersHandler } from '../loaders-handler.js';
import { defineAction, defineLoader } from '@hono-preact/iso';
import { VALIDATION_ISSUES_KEY } from '@hono-preact/iso/internal/runtime';

const NewTask = z.object({
  title: z.string().min(1),
  count: z.coerce.number().int(),
});

describe('Standard Schema end-to-end (Zod)', () => {
  it('rejects an invalid action payload with deny(422) + issues, coerces a valid one', async () => {
    const fn = vi.fn(
      async (_ctx: unknown, payload: { title: string; count: number }) => ({
        ok: payload.count,
      })
    );
    const create = defineAction(fn, { input: NewTask });
    const resolverByPath = async () =>
      new Map([
        [
          'create',
          {
            fn: create as never,
            use: [],
            moduleKey: 'pages/t.server',
            input: NewTask,
          },
        ],
      ]);
    const handler = pageActionsHandler({
      resolverByPath,
      resolvePageUseByPattern: async () => [],
      renderPage: (async (c: { html: (s: string) => unknown }) =>
        c.html('<!doctype html>X')) as never,
      resolvePageNode: () => h('div', null),
      appConfig: { use: [] },
    });
    const app = new Hono().post('*', handler);

    // invalid: empty title + non-numeric count
    const bad = await app.request('/t', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'pages/t.server',
        action: 'create',
        payload: { title: '', count: 'x' },
      }),
    });
    expect(bad.status).toBe(422);
    const badBody = await bad.json();
    expect(Array.isArray(badBody.data[VALIDATION_ISSUES_KEY])).toBe(true);
    expect(fn).not.toHaveBeenCalled();

    // valid: count coerced from string to number
    const good = await app.request('/t', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'pages/t.server',
        action: 'create',
        payload: { title: 'Hi', count: '5' },
      }),
    });
    expect(good.status).toBe(200);
    expect(fn).toHaveBeenCalledWith(expect.anything(), {
      title: 'Hi',
      count: 5,
    });
  });

  it('coerces loader search params and 400s on invalid', async () => {
    const ref = defineLoader(async (ctx) => ctx.location.searchParams, {
      searchSchema: z.object({ page: z.coerce.number().min(1) }),
    });
    const glob = {
      './t.server.ts': {
        __moduleKey: 'pages/t.server',
        serverLoaders: { default: ref },
      },
    };
    const handler = loadersHandler(glob, { resolvePageUse: async () => [] });
    const app = new Hono().post('*', handler);

    const ok = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/t.server',
        loader: 'default',
        location: { path: '/t', pathParams: {}, searchParams: { page: '2' } },
      }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ page: 2 });

    const bad = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/t.server',
        loader: 'default',
        location: { path: '/t', pathParams: {}, searchParams: { page: '0' } },
      }),
    });
    expect(bad.status).toBe(400);
  });

  it('surfaces loader search-schema issues under VALIDATION_ISSUES_KEY (parity with actions)', async () => {
    const ref = defineLoader(async (ctx) => ctx.location.searchParams, {
      searchSchema: z.object({ page: z.coerce.number().min(1) }),
    });
    const glob = {
      './t.server.ts': {
        __moduleKey: 'pages/t.server',
        serverLoaders: { default: ref },
      },
    };
    const handler = loadersHandler(glob, { resolvePageUse: async () => [] });
    const app = new Hono().post('*', handler);

    const bad = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/t.server',
        loader: 'default',
        location: { path: '/t', pathParams: {}, searchParams: { page: '0' } },
      }),
    });
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.__outcome).toBe('deny');
    expect(Array.isArray(body.data[VALIDATION_ISSUES_KEY])).toBe(true);
    expect(body.data[VALIDATION_ISSUES_KEY].length).toBeGreaterThan(0);
  });

  it('surfaces loader params-schema issues under VALIDATION_ISSUES_KEY (404 path)', async () => {
    const ref = defineLoader(async (ctx) => ctx.location.pathParams, {
      paramsSchema: z.object({ id: z.coerce.number().int() }),
    });
    const glob = {
      './t.server.ts': {
        __moduleKey: 'pages/t.server',
        serverLoaders: { default: ref },
      },
    };
    const handler = loadersHandler(glob, { resolvePageUse: async () => [] });
    const app = new Hono().post('*', handler);

    const bad = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/t.server',
        loader: 'default',
        location: { path: '/t', pathParams: { id: 'abc' }, searchParams: {} },
      }),
    });
    expect(bad.status).toBe(404);
    const body = await bad.json();
    expect(body.__outcome).toBe('deny');
    expect(Array.isArray(body.data[VALIDATION_ISSUES_KEY])).toBe(true);
    expect(body.data[VALIDATION_ISSUES_KEY].length).toBeGreaterThan(0);
  });
});
