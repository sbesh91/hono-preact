// @vitest-environment happy-dom
import { Component, h, type ComponentChildren, type VNode } from 'preact';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  render as rtlRender,
  screen,
  cleanup,
  waitFor,
} from '@testing-library/preact';
import { LocationProvider, Router, Route, type RouteHook } from 'preact-iso';
import { defineClientMiddleware } from '../../define-middleware.js';
import { PageMiddlewareHost } from '../page-middleware-host.js';
import { render as renderOutcome } from '../../page-only.js';
import { deny, isDeny, redirect } from '../../outcomes.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../history-shim.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Redirect dispatch reads the global "have we navigated yet" signal from
  // the history shim; reset it so tests do not leak nav state into each other.
  resetHistoryShimForTesting();
});

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
  route: () => {},
} as never;

// Mount a PageMiddlewareHost (carrying `mw`, rendering `childText`) as the /x
// route inside a Router, the post-navigation contract under test (the host needs
// an ancestor Router as its suspense boundary). `wrap` injects an element
// between the LocationProvider and the Router (e.g. an error boundary).
function renderHostInRouter(
  mw: ReturnType<typeof defineClientMiddleware>,
  childText: string,
  wrap?: (inner: VNode<any>) => VNode<any>
) {
  const HostRoute = () =>
    h(
      PageMiddlewareHost,
      { use: [mw], location: loc },
      h('div', null, childText)
    );
  window.history.replaceState({}, '', '/x');
  const router = h(
    Router,
    null,
    h(Route, { path: '/x', component: HostRoute as never })
  );
  return rtlRender(h(LocationProvider, null, wrap ? wrap(router) : router));
}

describe('PageMiddlewareHost', () => {
  it('renders children when no middleware short-circuits (client)', async () => {
    const mw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.queryByText('page-content')).not.toBeNull()
    );
  });

  it('renders the alternative component on render() outcome', async () => {
    const Alt = () => <div>alternative</div>;
    const mw = defineClientMiddleware(async () => {
      throw renderOutcome(Alt);
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.queryByText('alternative')).not.toBeNull()
    );
    expect(screen.queryByText('page-content')).toBeNull();
  });

  it('renders nothing while the chain is pending then renders children once resolved (post-navigation suspense path)', async () => {
    // Post-navigation (a prior client nav happened), the host takes the
    // Suspense path: nothing renders until the chain resolves. The
    // deferred/initial-load path is covered separately below.
    setNavDirectionForTesting('push');
    let resolve!: () => void;
    const mw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        resolve = r;
      });
      await next();
    });
    renderHostInRouter(mw, 'page-content');
    expect(screen.queryByText('page-content')).toBeNull();
    resolve();
    await waitFor(() =>
      expect(screen.queryByText('page-content')).not.toBeNull()
    );
  });

  it('on initial load renders the server children immediately while the client chain runs (deferred path)', async () => {
    // No navigation yet: the host renders the server-rendered children right
    // away (matching SSR so hydration cannot orphan them) and runs the client
    // chain post-hydration. Here the chain passes, so children stay.
    let resolve!: () => void;
    const mw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        resolve = r;
      });
      await next();
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    // Visible immediately, BEFORE the chain resolves (unlike the suspense path).
    expect(screen.queryByText('page-content')).not.toBeNull();
    resolve();
    await waitFor(() =>
      expect(screen.queryByText('page-content')).not.toBeNull()
    );
  });

  // B2 regression pin: PageMiddlewareHost must not re-dispatch the chain on
  // every render. Before the lazy-ref fix, `useRef(wrapPromise(startChain(...)))`
  // synchronously called `startChain` on each render before useRef decided
  // whether to use it, so the middleware function ran O(renders) times.
  it('runs each middleware once per path (does not re-dispatch on re-render)', async () => {
    const calls: number[] = [];
    let i = 0;
    const mw = defineClientMiddleware(async (_c, next) => {
      calls.push(++i);
      await next();
    });

    // Re-rendering the same tree triggers Preact reconciliation through
    // PageMiddlewareHost. Use rerender() to force multiple render passes
    // for the same path.
    const { rerender } = rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>once</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() => expect(screen.queryByText('once')).not.toBeNull());

    rerender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>once</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    rerender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>once</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );

    // Give any pending microtasks a chance to settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.length).toBe(1);
  });

  // B8: navigating between paths must re-enter the chain. The lazy-ref
  // sentinel resets when `location.path` changes, so the new path's
  // middleware runs fresh.
  it('re-enters middleware when location.path changes', async () => {
    let runs = 0;
    const mw = defineClientMiddleware(async (_c, next) => {
      runs += 1;
      await next();
    });

    const locA = {
      path: '/a',
      url: 'http://localhost/a',
      searchParams: {},
      pathParams: {},
      route: () => {},
    } as unknown as RouteHook;
    const locB = {
      path: '/b',
      url: 'http://localhost/b',
      searchParams: {},
      pathParams: {},
      route: () => {},
    } as unknown as RouteHook;

    const { rerender } = rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={locA}>
          <div>page</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() => expect(runs).toBeGreaterThanOrEqual(1));
    const afterA = runs;

    rerender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={locB}>
          <div>page</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() => expect(runs).toBe(afterA + 1));
  });

  // B9: client-side redirect from middleware on the INITIAL document load.
  // The host renders the server-rendered children during hydration (so the
  // hydrated DOM matches SSR and is never orphaned), then runs the client
  // chain post-hydration and navigates via SPA route() - NOT a hard
  // navigation. This is the deferred fix for the double-mount: the orphan only
  // happened because a Suspense boundary resolved to non-SSR content (null)
  // mid-hydration; rendering the children instead removes that mismatch, so a
  // plain route() from the fully hydrated tree is safe. The orphaned-DOM-on-
  // mismatch is expected Preact behavior (preactjs/preact#4442), so the fix
  // lives here on the consumer side.
  it('client redirect on initial load renders SSR children then navigates via SPA route() (no hard nav)', async () => {
    // No navigation yet: hasClientNavigated() is false, so the host takes the
    // deferred path. Reset between tests by the afterEach above.
    const assignSpy = vi.fn();
    Object.defineProperty(window.location, 'assign', {
      configurable: true,
      value: assignSpy,
    });

    const mw = defineClientMiddleware(async () => {
      throw redirect('/login');
    });

    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>protected-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );

    // The server children are rendered immediately (matching SSR) while the
    // client chain runs - they are NOT withheld.
    expect(screen.queryByText('protected-content')).not.toBeNull();

    // Once the chain resolves the redirect, an SPA route() moves the provider
    // URL to the target (happy-dom updates window.location.pathname).
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    // It must NOT have hard-navigated.
    expect(assignSpy).not.toHaveBeenCalled();
  });

  // B9b: a redirect that fires AFTER a client navigation takes the Suspense
  // path (HostConsumer) and navigates via SPA route(). Post-navigation there is
  // no hydration to mismatch, so the host suspends on the chain and renders the
  // redirect outcome (null) while an effect routes to the target. The signal is
  // global per document load (the history shim's nav direction), not per host,
  // so a freshly mounted host reached by navigating into a guarded route still
  // takes this path. This pins the post-navigation half of the behavior.
  it('client redirect after a navigation uses SPA route(), not a hard navigation', async () => {
    // Simulate a prior client navigation so hasClientNavigated() is true.
    setNavDirectionForTesting('push');

    const assignSpy = vi.fn();
    Object.defineProperty(window.location, 'assign', {
      configurable: true,
      value: assignSpy,
    });

    const mw = defineClientMiddleware(async () => {
      throw redirect('/login');
    });

    renderHostInRouter(mw, 'protected-content');

    await waitFor(() => {
      expect(screen.queryByText('protected-content')).toBeNull();
    });

    // SPA route() moves the provider URL to the target (happy-dom updates
    // window.location.pathname inside route()).
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    // It must NOT have hard-navigated.
    expect(assignSpy).not.toHaveBeenCalled();
  });

  // M-5: a `deny` OUTCOME thrown by a page middleware chain is a control-flow
  // signal, not a thenable. It must propagate past the Router (which only
  // intercepts thenables for suspension) to an OUTER boundary, so renderPage /
  // the dispatcher can translate it to a 403.
  it('propagates a thrown deny outcome to an outer boundary (Router is the suspense boundary)', async () => {
    let caught: unknown = null;
    class OuterCatch extends Component<{ children: ComponentChildren }> {
      static getDerivedStateFromError(error: unknown) {
        caught = error;
        return {};
      }
      render() {
        return caught !== null ? <div>outer-caught</div> : this.props.children;
      }
    }

    setNavDirectionForTesting('push');

    const mw = defineClientMiddleware(async () => {
      throw deny(403, 'nope');
    });

    renderHostInRouter(mw, 'protected-content', (router) =>
      h(OuterCatch, null, router)
    );

    await waitFor(() =>
      expect(screen.queryByText('outer-caught')).not.toBeNull()
    );
    expect(screen.queryByText('protected-content')).toBeNull();
    expect(isDeny(caught)).toBe(true);
  });
});
