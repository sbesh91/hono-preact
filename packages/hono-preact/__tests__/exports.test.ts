import { describe, it, expect, vi } from 'vitest';

// Every test here does `await import('hono-preact'…)`, which the vitest alias
// resolves to the package's *source* entry. The first import of each entry
// triggers a cold Vite transform of a large graph (iso + server + the Vite
// plugin), and under a saturated parallel pool that can exceed the default
// 5000ms per-test timeout — surfacing as flaky timeouts on the heaviest graphs
// (the root runtime and the Vite plugin). These are import-surface assertions,
// not timing tests, so give them generous headroom.
vi.setConfig({ testTimeout: 30000 });

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
    // Iso runtime exports added by Spec C
    expect(typeof m.useActionResult).toBe('function');
    expect(typeof m.useFormStatus).toBe('function');
    expect(m.ActionResultContext).toBeTruthy();
  });

  it('surfaces the outcome predicates at the root', async () => {
    const m = await import('hono-preact');
    expect(typeof m.isOutcome).toBe('function');
    expect(typeof m.isRedirect).toBe('function');
    expect(typeof m.isDeny).toBe('function');
    expect(typeof m.isRender).toBe('function');
  });

  it('surfaces bootClient for custom client entries', async () => {
    const m = await import('hono-preact');
    expect(typeof m.bootClient).toBe('function');
  });

  it('does NOT surface server-only symbols at the root', async () => {
    const m = await import('hono-preact');
    expect((m as Record<string, unknown>).renderPage).toBeUndefined();
  });

  it('does NOT surface render() (page-scope only) at the root', async () => {
    const m = await import('hono-preact');
    expect((m as Record<string, unknown>).render).toBeUndefined();
  });
});

describe('hono-preact/page export (page-scope kitchen sink)', () => {
  it('surfaces every outcome constructor and predicate the docs reference', async () => {
    const m = await import('hono-preact/page');
    expect(typeof m.redirect).toBe('function');
    expect(typeof m.deny).toBe('function');
    expect(typeof m.render).toBe('function');
    expect(typeof m.isOutcome).toBe('function');
    expect(typeof m.isRedirect).toBe('function');
    expect(typeof m.isDeny).toBe('function');
    expect(typeof m.isRender).toBe('function');
  });
});

describe('hono-preact/server export', () => {
  it('surfaces the SSR + context public API', async () => {
    const m = await import('hono-preact/server');
    expect(typeof m.renderPage).toBe('function');
    expect(typeof m.HonoContext).toBe('function');
    expect(typeof m.useHonoContext).toBe('function');
  });

  it('no longer surfaces the low-level handlers (moved to /server/internal/runtime wiring)', async () => {
    // The value-bearing handlers are checked here; the type-only removals (ActionEntry, LoadersHandlerOptions, PageActionsHandlerOptions) are erased at runtime and are enforced by pnpm typecheck instead.
    const m = await import('hono-preact/server');
    expect('loadersHandler' in m).toBe(false);
    expect('pageActionsHandler' in m).toBe(false);
  });

  it('no longer surfaces the framework-emitted resolver factories', async () => {
    const m = await import('hono-preact/server');
    expect('routeServerModules' in m).toBe(false);
    expect('makePageUseResolver' in m).toBe(false);
    expect('makePageActionResolvers' in m).toBe(false);
  });
});

describe('hono-preact/server/internal/runtime export', () => {
  it('surfaces the framework-emitted createServerEntry factory', async () => {
    const m = await import('hono-preact/server/internal/runtime');
    expect(typeof m.createServerEntry).toBe('function');
  });

  it('does not re-surface the low-level handlers or resolver factories', async () => {
    const m = await import('hono-preact/server/internal/runtime');
    expect('loadersHandler' in m).toBe(false);
    expect('pageActionsHandler' in m).toBe(false);
    expect('routeServerModules' in m).toBe(false);
    expect('makePageUseResolver' in m).toBe(false);
    expect('makePageActionResolvers' in m).toBe(false);
  });
});

describe('hono-preact/vite export', () => {
  it('surfaces the Vite plugin entry', async () => {
    const m = await import('hono-preact/vite');
    expect(typeof m.honoPreact).toBe('function');
  });
});

describe('hono-preact/signals export', () => {
  it('surfaces the opt-in signal-backed presence installer', async () => {
    const m = await import('hono-preact/signals');
    expect(typeof m.installPresenceSignals).toBe('function');
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
    expect(typeof m.isMiddleware).toBe('function');
    expect(typeof m.isObserver).toBe('function');
    expect(typeof m.HonoRequestContext).toBe('function');
    expect(typeof m.subscribeToLoaderStream).toBe('function');
    expect(typeof m.registerServerStreamingLoader).toBe('function');
    expect(typeof m.takeServerStreamingLoaders).toBe('function');
    expect(typeof m.runRequestScope).toBe('function');
  });
});

describe('hono-preact/internal/runtime export', () => {
  it('surfaces the framework-emitted installers + loader stub', async () => {
    const m = await import('hono-preact/internal/runtime');
    expect(typeof m.installHistoryShim).toBe('function');
    expect(typeof m.installNavTransitionScheduler).toBe('function');
    expect(typeof m.installStreamRegistry).toBe('function');
    expect(typeof m.__$createLoaderStub_hpiso).toBe('function');
    expect(typeof m.LOADERS_RPC_PATH).toBe('string');
  });

  it('no longer surfaces the installers from the escape-hatch /internal door', async () => {
    const m = await import('hono-preact/internal');
    expect('installStreamRegistry' in m).toBe(false);
    expect('installHistoryShim' in m).toBe(false);
  });
});
