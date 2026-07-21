// @vitest-environment happy-dom
// SPIKE (throwaway): the reverse import order. `g()` in @preact/signals binds
// whatever is on `options` at import time, and preact-iso's lazy.js does the
// same, so whichever imports LAST wraps the other. This file loads preact-iso
// first and signals second; signals-spike.test.tsx does the opposite. Both
// orders must produce a working suspend + a working signal binding, otherwise
// the framework would have to control import order at the entry point.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/preact';
// preact-iso FIRST (installs options.__b / options.__e)
import { lazy, ErrorBoundary } from 'preact-iso';
// signals SECOND (wraps them)
import { signal } from '@preact/signals';
import type { VNode } from 'preact';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('reverse import order: preact-iso then signals', () => {
  it('suspend still resolves and the signal still binds', async () => {
    let release!: (v: { default: () => VNode }) => void;
    const pending = new Promise<{ default: () => VNode }>((r) => {
      release = r;
    });
    const onError = vi.fn();
    const label = signal('before');
    const Lazy = lazy(() => pending);

    render(
      <ErrorBoundary onError={onError}>
        <Lazy />
      </ErrorBoundary>
    );

    expect(screen.queryByTestId('ordered')).toBeNull();

    await act(async () => {
      release({ default: () => <p data-testid="ordered">{label}</p> });
      await pending;
    });

    await waitFor(() => expect(screen.getByTestId('ordered')).toBeTruthy());
    expect(screen.getByTestId('ordered').textContent).toBe('before');
    expect(onError).not.toHaveBeenCalled();

    await act(async () => {
      label.value = 'after';
    });
    expect(screen.getByTestId('ordered').textContent).toBe('after');
  });

  it('granularity survives the reverse order too', async () => {
    const v = signal(0);
    const renders = vi.fn();

    function Row() {
      renders();
      return <p data-testid="ord-row">{v}</p>;
    }

    render(<Row />);
    expect(renders).toHaveBeenCalledTimes(1);

    await act(async () => {
      v.value = 42;
    });

    expect(screen.getByTestId('ord-row').textContent).toBe('42');
    expect(renders).toHaveBeenCalledTimes(1);
  });
});
