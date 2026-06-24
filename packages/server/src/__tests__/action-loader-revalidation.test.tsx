// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import {
  defineLoader,
  defineAction,
  useAction,
  type ActionRef,
} from '@hono-preact/iso';
import { env } from '@hono-preact/iso/internal/runtime';
import { Loader } from '@hono-preact/iso/internal';
import { loadersHandler } from '../loaders-handler.js';
import { pageActionsHandler } from '../page-actions-handler.js';
import { makePageActionResolvers } from '../page-action-resolvers.js';

const loc = {
  path: '/items',
  url: 'http://localhost/items',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  env.current = originalEnv;
});

describe('action -> loader revalidation (end-to-end through real handlers)', () => {
  it('invalidate:"auto" refetches the active loader from the server after an action commits', async () => {
    // Server state the loader reads and the action mutates. The point of
    // this test: every existing optimistic/invalidation test fakes the
    // server side by manually swapping `base` props. Here we stand up the
    // real `loadersHandler` + `pageActionsHandler`, route the browser-side
    // `fetch` to the Hono app, and assert the loader actually re-runs
    // against the same backing state after the action settles.
    let serverCount = 1;

    const countLoader = defineLoader<{ count: number }>(
      async () => ({ count: serverCount }),
      { __moduleKey: 'pages/items', __loaderName: 'default' }
    );

    const increment = defineAction<void, { ok: true }>(async () => {
      serverCount += 1;
      return { ok: true };
    });

    // Module shape the framework's handlers consume (matches what
    // `routeServerModules` / the user's `.server.ts` files produce).
    const serverModule = {
      __moduleKey: 'pages/items',
      serverLoaders: { default: countLoader },
      serverActions: { increment },
    };
    const glob = { './pages/items.server.ts': serverModule };

    // Build the pageActionsHandler using the same server route structure the
    // framework's generated server entry produces. In happy-dom, window.location
    // defaults to '/', so useAction posts to '/'. Register the route at '/' so
    // the resolver finds the action when the request arrives.
    const serverRoutes = [
      {
        path: '/',
        server: async () => serverModule,
        ancestors: [],
      },
    ];
    const pageActionResolvers = makePageActionResolvers(serverRoutes, {
      dev: true,
    });
    const noopRender = async () => new Response('', { status: 200 });

    const honoApp = new Hono()
      .post(
        '/__loaders',
        loadersHandler(glob, { resolvePageUse: async () => [] })
      )
      .post(
        '*',
        pageActionsHandler({
          resolverByPath: pageActionResolvers.byPath,
          resolvePageUseByPath: async () => [], // no page-level middleware in this fixture
          renderPage: noopRender as never,
          resolvePageNode: () => null,
        })
      );

    // Route every fetch to the Hono app. Both the loader RPC stub
    // (`/__loaders`) and the action POST (mounted at `*` by pageActionsHandler)
    // call through `fetch(...)`; pointing both at the same Hono app exercises
    // the real wire format on both sides.
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const absolute = url.startsWith('http')
          ? url
          : `http://localhost${url}`;
        // Hono's Response may not interop cleanly with happy-dom's Response
        // (different prototypes between the test-env's web Fetch API and
        // Hono's). Re-materialize the body into a fresh Response so the
        // caller's `.json()` / `.text()` use happy-dom's implementations.
        const honoRes = await honoApp.request(absolute, init);
        const body = await honoRes.text();
        const headers = new Headers();
        honoRes.headers.forEach((v, k) => headers.set(k, v));
        return new Response(body, {
          status: honoRes.status,
          headers,
        });
      }
    );
    vi.stubGlobal('fetch', fetchSpy);

    // Action stub matching what the Vite plugin would emit on the client
    // side (the runtime function is replaced by a Proxy that POSTs).
    const incrementStub = {
      __module: 'pages/items',
      __action: 'increment',
    } as unknown as ActionRef<void, { ok: true }>;

    function CountView() {
      const { count } = countLoader.useData();
      const { mutate } = useAction(incrementStub, { invalidate: 'auto' });
      return (
        <div>
          <span data-testid="count">count: {count}</span>
          <button onClick={() => mutate(undefined as void)}>bump</button>
        </div>
      );
    }

    render(
      <LocationProvider>
        <Loader loader={countLoader} location={loc}>
          <CountView />
        </Loader>
      </LocationProvider>
    );

    // Initial loader fetch resolves with serverCount = 1.
    await screen.findByText('count: 1');

    // Click triggers the action; server increments; auto-invalidate
    // refetches the loader; UI updates to count: 2.
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('count: 2')
    );

    // One more for good measure — confirms the cycle is repeatable, not
    // a one-shot artifact.
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('count: 3')
    );

    expect(serverCount).toBe(3);
  });
});
