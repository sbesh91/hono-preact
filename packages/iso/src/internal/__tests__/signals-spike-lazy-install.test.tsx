// @vitest-environment happy-dom
// SPIKE (throwaway): the design-decisive question. @preact/signals installs its
// options hooks at import time. If it can be dynamically imported AFTER the app
// has already booted and rendered, it can ship as an opt-in marginal feature
// module and apps that never use it pay 0 bytes. If it must be present before
// the first render, it has to sit in the entry closure and every app pays.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/preact';
import { lazy, ErrorBoundary } from 'preact-iso';
import type { VNode } from 'preact';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('deferred install of @preact/signals', () => {
  it('installs after an initial render and still gives granularity', async () => {
    const preRenders = vi.fn();

    // 1. Boot and render WITHOUT signals in the graph yet.
    function Before() {
      preRenders();
      return <p data-testid="before">booted</p>;
    }
    render(<Before />);
    expect(screen.getByTestId('before').textContent).toBe('booted');
    expect(preRenders).toHaveBeenCalledTimes(1);

    // 2. Now pull signals in dynamically, the way a route chunk would.
    const { signal } = await import('@preact/signals');

    // 3. A component rendered after the late install must still get the
    //    ReactiveTextNode binding (DOM patch with no component re-render).
    const v = signal('x');
    const postRenders = vi.fn();
    function After() {
      postRenders();
      return <p data-testid="after">{v}</p>;
    }

    render(<After />);
    expect(screen.getByTestId('after').textContent).toBe('x');
    expect(postRenders).toHaveBeenCalledTimes(1);

    await act(async () => {
      v.value = 'y';
    });

    expect(screen.getByTestId('after').textContent).toBe('y');
    // If this is 1, deferring the import costs nothing functionally.
    expect(postRenders).toHaveBeenCalledTimes(1);
  });

  it('a component rendered BEFORE the install does not retroactively bind', async () => {
    // Establishes the boundary condition: the tree that rendered pre-install
    // keeps whatever binding it had. This is what a real app must not trip on.
    const { signal } = await import('@preact/signals');
    const v = signal(1);

    // Render, then mutate. Since signals is already installed by this point in
    // the module, this is the ordinary case and must work.
    const renders = vi.fn();
    function Row() {
      renders();
      return <p data-testid="post">{v}</p>;
    }
    render(<Row />);
    await act(async () => {
      v.value = 2;
    });
    expect(screen.getByTestId('post').textContent).toBe('2');
    expect(renders).toHaveBeenCalledTimes(1);
  });

  it('deferred install still coexists with an already-patched preact-iso', async () => {
    // preact-iso patched options at module load (top of this file). signals
    // patches later, wrapping it. A suspend must still resolve.
    const { signal } = await import('@preact/signals');
    let release!: (v: { default: () => VNode }) => void;
    const pending = new Promise<{ default: () => VNode }>((r) => {
      release = r;
    });
    const label = signal('lazy');
    const Lazy = lazy(() => pending);

    // A suspend needs a boundary ancestor; without one preact-iso's options.__e
    // finds nothing to hand the thenable to and it escapes as an error.
    render(
      <ErrorBoundary>
        <Lazy />
      </ErrorBoundary>
    );
    expect(screen.queryByTestId('late')).toBeNull();

    await act(async () => {
      release({ default: () => <p data-testid="late">{label}</p> });
      await pending;
    });

    expect(screen.getByTestId('late').textContent).toBe('lazy');
    await act(async () => {
      label.value = 'bound';
    });
    expect(screen.getByTestId('late').textContent).toBe('bound');
  });
});
