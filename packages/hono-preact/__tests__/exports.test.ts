import { describe, it, expect } from 'vitest';

describe('hono-preact root export (iso runtime)', () => {
  it('surfaces the page + route + loader + action public API', async () => {
    const m = await import('hono-preact');
    expect(typeof m.definePage).toBe('function');
    expect(typeof m.defineRoutes).toBe('function');
    expect(typeof m.defineLoader).toBe('function');
    expect(typeof m.defineAction).toBe('function');
    expect(typeof m.defineServerMiddleware).toBe('function');
    expect(typeof m.defineClientMiddleware).toBe('function');
    expect(typeof m.defineStreamObserver).toBe('function');
    expect(typeof m.defineApp).toBe('function');
    expect(typeof m.redirect).toBe('function');
    expect(typeof m.deny).toBe('function');
    expect(typeof m.useAction).toBe('function');
    expect(typeof m.useOptimisticAction).toBe('function');
    expect(typeof m.useReload).toBe('function');
    expect(typeof m.useLocation).toBe('function');
    expect(typeof m.Form).toBe('function');
    expect(typeof m.Routes).toBe('function');
    expect(typeof m.Head).toBe('function');
    expect(typeof m.ClientScript).toBe('function');
  });

  it('does NOT surface server-only symbols at the root', async () => {
    const m = await import('hono-preact');
    expect((m as Record<string, unknown>).renderPage).toBeUndefined();
  });
});

describe('hono-preact/server export', () => {
  it('surfaces the SSR + handlers public API', async () => {
    const m = await import('hono-preact/server');
    expect(typeof m.renderPage).toBe('function');
    expect(typeof m.loadersHandler).toBe('function');
    expect(typeof m.actionsHandler).toBe('function');
    expect(typeof m.routeServerModules).toBe('function');
    expect(typeof m.makePageUseResolvers).toBe('function');
  });
});

describe('hono-preact/vite export', () => {
  it('surfaces the Vite plugin entry', async () => {
    const m = await import('hono-preact/vite');
    expect(typeof m.honoPreact).toBe('function');
  });
});

describe('hono-preact/internal export', () => {
  it('surfaces the escape-hatch primitives', async () => {
    const m = await import('hono-preact/internal');
    expect(typeof m.Loader).toBe('function');
    expect(typeof m.Envelope).toBe('function');
    expect(typeof m.RouteBoundary).toBe('function');
    expect(typeof m.PageMiddlewareHost).toBe('function');
    expect(typeof m.dispatchServer).toBe('function');
    expect(typeof m.dispatchClient).toBe('function');
    expect(typeof m.partitionUse).toBe('function');
    expect(typeof m.HonoRequestContext).toBe('function');
    expect(typeof m.installStreamRegistry).toBe('function');
    expect(typeof m.subscribeToLoaderStream).toBe('function');
    expect(typeof m.registerServerStreamingLoader).toBe('function');
    expect(typeof m.takeServerStreamingLoaders).toBe('function');
    expect(typeof m.runRequestScope).toBe('function');
  });
});
