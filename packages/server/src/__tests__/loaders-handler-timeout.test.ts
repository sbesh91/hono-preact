import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { loadersHandler } from '../loaders-handler.js';
import { defineLoader, isTimeout } from '@hono-preact/iso';

function makeApp(glob: Parameters<typeof loadersHandler>[0]) {
  const app = new Hono();
  app.post('/__loaders', loadersHandler(glob));
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request('http://localhost/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const location = { path: '/', pathParams: {}, searchParams: {} };

describe('loadersHandler timeouts', () => {
  it('returns a timeout outcome when the loader exceeds its timeoutMs', async () => {
    const ref = defineLoader(
      async ({ signal }) => {
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        return 'never';
      },
      { __moduleKey: 'slow', __loaderName: 'list', timeoutMs: 50 }
    );

    const app = makeApp({
      './pages/slow.server.ts': {
        __moduleKey: 'slow',
        serverLoaders: { list: ref },
      },
    });

    const res = await post(app, { module: 'slow', loader: 'list', location });
    expect(res.status).toBe(504);
    const body = (await res.json()) as unknown;
    expect(isTimeout(body)).toBe(true);
    expect((body as { timeoutMs: number }).timeoutMs).toBe(50);
  });

  it('uses the handler default when timeoutMs is undefined on the loader', async () => {
    const ref = defineLoader(
      async ({ signal }) => {
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        return 'never';
      },
      { __moduleKey: 'fast', __loaderName: 'list' }
    );

    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler(
        {
          './pages/fast.server.ts': {
            __moduleKey: 'fast',
            serverLoaders: { list: ref },
          },
        },
        { defaultTimeoutMs: 50 }
      )
    );

    const res = await app.request('http://localhost/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'fast', loader: 'list', location }),
    });

    expect(res.status).toBe(504);
    const body = (await res.json()) as { timeoutMs: number };
    expect(isTimeout(body)).toBe(true);
    // The reported timeoutMs MUST be the handler default, proving the
    // resolution path fell back from `entry.timeoutMs` (undefined) to
    // `defaultTimeoutMs` rather than skipping composition entirely.
    expect(body.timeoutMs).toBe(50);
  });

  it('disables the timeout when timeoutMs is false (even when defaultTimeoutMs is small)', async () => {
    let aborted = false;
    const ref = defineLoader(
      async ({ signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 75));
        aborted = signal.aborted;
        return 'ok';
      },
      { __moduleKey: 'untimed', __loaderName: 'list', timeoutMs: false }
    );

    const app = new Hono();
    // Use a small default that would absolutely fire within the 75ms sleep
    // if `false` were not honored. This makes the test discriminating against
    // a broken implementation that ignores the `false` opt-out.
    app.post(
      '/__loaders',
      loadersHandler(
        {
          './pages/untimed.server.ts': {
            __moduleKey: 'untimed',
            serverLoaders: { list: ref },
          },
        },
        { defaultTimeoutMs: 25 }
      )
    );

    const res = await app.request('http://localhost/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'untimed', loader: 'list', location }),
    });
    expect(res.status).toBe(200);
    expect(aborted).toBe(false);
  });

  it('signal.reason inside the loader is a TimeoutError DOMException', async () => {
    let observedReason: unknown;
    const ref = defineLoader(
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
        return 'never';
      },
      { __moduleKey: 'slow2', __loaderName: 'list', timeoutMs: 50 }
    );

    const app = makeApp({
      './pages/slow2.server.ts': {
        __moduleKey: 'slow2',
        serverLoaders: { list: ref },
      },
    });

    await post(app, { module: 'slow2', loader: 'list', location });
    expect(observedReason).toBeInstanceOf(DOMException);
    expect((observedReason as DOMException).name).toBe('TimeoutError');
  });
});
