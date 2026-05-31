// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { h } from 'preact';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { LocationProvider, useLocation } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import {
  __dispatchRouteChange,
  installNavTransitionScheduler,
  resetDefaultTypesForTesting,
  __resetTransitionStateForTesting,
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
  // Reset the coordinator's loadingDepth/pending so a navigation left mid-load
  // by one test cannot misclassify the next test's navigation.
  __resetTransitionStateForTesting();
  // The first test navigates to /about via history.pushState; subsequent
  // tests need to start fresh at '/' or their LocationProvider initialises
  // off the leftover URL and renders About instead of Home.
  if (typeof window !== 'undefined') {
    window.history.pushState(null, '', '/');
  }
});

// Real-DOM test that exercises the FULL wiring chain end-to-end:
//   a navigation triggers a Preact render flush → the render scheduler
//   (installed by installNavTransitionScheduler, which overrides
//   options.debounceRendering) wraps that flush in document.startViewTransition
//   → the Router (mounted by `Routes`) swaps in the new route inside it.
//
// This is the guard that a real navigation reaches the coordinator: the
// transition must start before the route re-renders so the browser can capture
// the outgoing route as the old snapshot.
describe('view transitions: end-to-end wiring', () => {
  // A view component that uses useLocation so we can trigger a programmatic
  // navigation from inside the rendered tree (mirrors how real apps call
  // `useLocation().route(...)` from event handlers).
  const Home = () => {
    const { route } = useLocation();
    return h('button', { onClick: () => route('/about') }, 'go to about');
  };
  const About = () => {
    const { route } = useLocation();
    return h('button', { onClick: () => route('/') }, 'back to home');
  };

  const makeFakeVt = () =>
    vi.fn((cb: () => void | Promise<void>) => {
      // Real browsers run the update callback asynchronously, after capturing
      // the old snapshot; mirror that here.
      void Promise.resolve().then(() => cb());
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        types: { add: () => {} },
        skipTransition: () => {},
      };
    });

  it('wraps a navigation in document.startViewTransition via the render scheduler', async () => {
    const startViewTransition = makeFakeVt();
    Object.assign(document, { startViewTransition });
    installNavTransitionScheduler();

    const routes = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: Home }) },
      { path: '/about', view: () => Promise.resolve({ default: About }) },
    ]);

    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes }))
    );

    // Wait for the lazy Home view to mount.
    await waitFor(() =>
      expect(container.querySelector('button')?.textContent).toBe('go to about')
    );
    // The initial mount is not a navigation.
    expect(startViewTransition).not.toHaveBeenCalled();

    // A user navigation's render flush is wrapped in a view transition by the
    // scheduler, and lands on /about.
    fireEvent.click(container.querySelector('button')!);
    await waitFor(() => expect(startViewTransition).toHaveBeenCalledTimes(1));
    expect(typeof startViewTransition.mock.calls[0][0]).toBe('function');
    await waitFor(() =>
      expect(container.querySelector('button')?.textContent).toBe(
        'back to home'
      )
    );
  });

  it('navigates without throwing when the view-transition API is unavailable', async () => {
    // Browsers without view-transitions: the navigation still runs, no throw.
    Object.assign(document, { startViewTransition: undefined });
    installNavTransitionScheduler();

    const routes = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: Home }) },
      { path: '/about', view: () => Promise.resolve({ default: About }) },
    ]);

    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes }))
    );
    await waitFor(() =>
      expect(container.querySelector('button')?.textContent).toBe('go to about')
    );

    expect(() =>
      fireEvent.click(container.querySelector('button')!)
    ).not.toThrow();
    await waitFor(() =>
      expect(container.querySelector('button')?.textContent).toBe(
        'back to home'
      )
    );
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
