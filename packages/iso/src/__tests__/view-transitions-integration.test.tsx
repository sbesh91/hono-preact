// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { h } from 'preact';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { LocationProvider, useLocation } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import {
  __dispatchRouteChange,
  resetDefaultTypesForTesting,
} from '../internal/route-change.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';
import { __persistRegistryResetForTesting } from '../internal/persist-registry.js';
import {
  ViewTransitionName,
  Persist,
  PersistHost,
  useViewTransitionLifecycle,
  useViewTransitionTypes,
} from '../index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The first test navigates to /about via history.pushState; subsequent
  // tests need to start fresh at '/' or their LocationProvider initialises
  // off the leftover URL and renders About instead of Home.
  if (typeof window !== 'undefined') {
    window.history.pushState(null, '', '/');
  }
});

// Real-DOM test that exercises the FULL wiring chain end-to-end:
//   LocationProvider → preact-iso <Router> (mounted by `Routes`) →
//   onRouteChange callback fires in useLayoutEffect → __dispatchRouteChange
//   → document.startViewTransition(cb).
//
// The previous coverage in route-change.test.ts called __dispatchRouteChange
// directly with a stubbed document. That tests "the dispatcher invokes the
// API when enabled"; it does NOT test that a real Router-driven navigation
// actually reaches the dispatcher. Given how recently the view-transitions
// opt-in plumbing thrashed (74f952c → e837831), this is the regression we
// most want a guard against.
describe('view transitions: end-to-end wiring', () => {
  // A view component that uses useLocation so we can trigger a programmatic
  // navigation from inside the rendered tree (mirrors how real apps call
  // `useLocation().route(...)` from event handlers).
  const Home = () => {
    const { route } = useLocation();
    return h('button', { onClick: () => route('/about') }, 'go to about');
  };
  const About = () => h('h1', null, 'About');

  it('fires document.startViewTransition once per navigation triggered through the Router', async () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
    });
    Object.assign(document, { startViewTransition });

    const routes = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: Home }) },
      { path: '/about', view: () => Promise.resolve({ default: About }) },
    ]);

    // Wire onRouteChange the same way the framework's generated client
    // entry does: forward every Router commit into __dispatchRouteChange.
    let lastPath: string | undefined;
    function onRouteChange(path: string): void {
      const from = lastPath;
      lastPath = path;
      __dispatchRouteChange(path, from);
    }

    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes, onRouteChange }))
    );

    // Wait for the lazy Home view to mount.
    await waitFor(() =>
      expect(container.querySelector('button')).not.toBeNull()
    );

    // Initial mount does not fire onRouteChange (preact-iso's Router only
    // fires onRouteChange when prevRoute.current !== path). startViewTransition
    // should still be at zero calls before any user-driven nav.
    expect(startViewTransition).not.toHaveBeenCalled();

    // Click triggers route('/about') → reducer updates url → Router renders
    // About → useLayoutEffect fires onRouteChange → __dispatchRouteChange →
    // startViewTransition.
    fireEvent.click(container.querySelector('button')!);

    await waitFor(() => expect(startViewTransition).toHaveBeenCalledTimes(1));
    // The callback passed to startViewTransition must be a function. Real
    // browsers call it inside the snapshot window; the framework hands them
    // `() => flushSync(() => {})`.
    expect(typeof startViewTransition.mock.calls[0][0]).toBe('function');
  });

  it('does not call startViewTransition when the API is unavailable on document', async () => {
    // Browsers without view-transitions: dispatching should still notify
    // subscribers (other __dispatchRouteChange consumers) without throwing.
    Object.assign(document, { startViewTransition: undefined });

    const routes = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: Home }) },
      { path: '/about', view: () => Promise.resolve({ default: About }) },
    ]);

    let lastPath: string | undefined;
    const onRouteChange = (path: string): void => {
      const from = lastPath;
      lastPath = path;
      __dispatchRouteChange(path, from);
    };

    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes, onRouteChange }))
    );
    await waitFor(() =>
      expect(container.querySelector('button')).not.toBeNull()
    );

    // Should NOT throw and should NOT call any view-transition API.
    expect(() =>
      fireEvent.click(container.querySelector('button')!)
    ).not.toThrow();
  });
});

describe('toolkit integration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
    __persistRegistryResetForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('A+B+C+D fire together across a single navigation', async () => {
    const typeAdds: string[] = [];
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const originalStart = (document as { startViewTransition?: unknown })
      .startViewTransition;
    (
      document as unknown as {
        startViewTransition: (cb: () => void) => unknown;
      }
    ).startViewTransition = (cb: () => void) => {
      cb();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished,
        types: { add: (t: string) => typeAdds.push(t) },
      };
    };
    // Prime the "first dispatch seen" flag so subsequent navigations get a
    // direction type rather than nav-initial. The very first dispatch in a
    // fresh dispatcher state always emits nav-initial regardless of direction;
    // real apps always have the initial page load as that first dispatch.
    __dispatchRouteChange('/', undefined);

    setNavDirectionForTesting('back');

    const phases: string[] = [];
    function App() {
      useViewTransitionLifecycle({
        onBeforeTransition: () => phases.push('bt'),
        onAfterSwap: () => phases.push('as'),
      });
      useViewTransitionTypes(['custom-type']);
      return (
        <div>
          <ViewTransitionName name="hero">
            <h1>title</h1>
          </ViewTransitionName>
          <Persist id="player">
            <span data-id="audio">audio</span>
          </Persist>
          <PersistHost />
        </div>
      );
    }
    const { unmount } = render(<App />);

    __dispatchRouteChange('/posts', '/posts/1');
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();

    // A: view-transition-name applied to the hero element
    const heroes = document.querySelectorAll('[style*="view-transition-name"]');
    expect(heroes.length).toBeGreaterThan(0);

    // B: lifecycle phases fired in order
    expect(phases).toEqual(expect.arrayContaining(['bt', 'as']));

    // C: nav-back (direction), nav-same-origin (always), custom-type (consumer)
    expect(typeAdds).toEqual(
      expect.arrayContaining(['nav-back', 'nav-same-origin', 'custom-type'])
    );

    // D: PersistHost rendered the registry entry
    const slot = document.querySelector('[data-hp-persist-slot="player"]');
    expect(slot?.textContent).toBe('audio');

    unmount();
    // Restore the original (may be undefined in happy-dom).
    if (originalStart === undefined) {
      delete (document as { startViewTransition?: unknown })
        .startViewTransition;
    } else {
      (
        document as unknown as {
          startViewTransition: unknown;
        }
      ).startViewTransition = originalStart;
    }
  });
});
