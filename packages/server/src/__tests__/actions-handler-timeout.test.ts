import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { actionsHandler } from '../actions-handler.js';
import { defineAction, isTimeout } from '@hono-preact/iso';

function makeApp(glob: Parameters<typeof actionsHandler>[0]) {
  const app = new Hono();
  app.post('/__actions', actionsHandler(glob));
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request('http://localhost/__actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('actionsHandler timeouts', () => {
  it('returns a timeout outcome when the action exceeds its timeoutMs', async () => {
    const create = defineAction(
      async ({ signal }) => {
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        return { id: 1 };
      },
      { timeoutMs: 50 }
    );

    const app = makeApp({
      './pages/slow.server.ts': {
        __moduleKey: 'slow',
        serverActions: { create },
      },
    });

    const res = await post(app, {
      module: 'slow',
      action: 'create',
      payload: {},
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as unknown;
    expect(isTimeout(body)).toBe(true);
    expect((body as { timeoutMs: number }).timeoutMs).toBe(50);
  });

  it('uses the handler default when the action has no timeoutMs', async () => {
    const create = defineAction(async ({ signal }) => {
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return { ok: true };
    });

    const app = new Hono();
    app.post(
      '/__actions',
      actionsHandler(
        {
          './pages/fast.server.ts': {
            __moduleKey: 'fast',
            serverActions: { create },
          },
        },
        { defaultTimeoutMs: 50 }
      )
    );

    const res = await app.request('http://localhost/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'fast', action: 'create', payload: {} }),
    });

    expect(res.status).toBe(504);
    const body = (await res.json()) as { timeoutMs: number };
    expect(isTimeout(body)).toBe(true);
    // Proves the default path created a timeout signal (not the per-action value)
    expect(body.timeoutMs).toBe(50);
  });

  it('disables the timeout when timeoutMs is false (even when defaultTimeoutMs is small)', async () => {
    const create = defineAction(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 75));
        return { ok: true };
      },
      { timeoutMs: false }
    );

    const app = new Hono();
    app.post(
      '/__actions',
      actionsHandler(
        {
          './pages/untimed.server.ts': {
            __moduleKey: 'untimed',
            serverActions: { create },
          },
        },
        { defaultTimeoutMs: 25 }
      )
    );

    const res = await app.request('http://localhost/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'untimed', action: 'create', payload: {} }),
    });
    expect(res.status).toBe(200);
  });

  it('signal.reason inside the action is a TimeoutError DOMException', async () => {
    let observedReason: unknown;
    const create = defineAction(
      async ({ signal }) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              observedReason = signal.reason;
              resolve();
            },
            { once: true }
          );
        });
        return { id: 0 };
      },
      { timeoutMs: 50 }
    );

    const app = makeApp({
      './pages/slow2.server.ts': {
        __moduleKey: 'slow2',
        serverActions: { create },
      },
    });

    await post(app, { module: 'slow2', action: 'create', payload: {} });
    expect(observedReason).toBeInstanceOf(DOMException);
    expect((observedReason as DOMException).name).toBe('TimeoutError');
  });
});
