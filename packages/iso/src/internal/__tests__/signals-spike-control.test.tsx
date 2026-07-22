// @vitest-environment happy-dom
// SPIKE CONTROL (throwaway): the error-handling assertions from
// signals-spike.test.tsx run here with NO @preact/signals anywhere in the
// module graph. Identical results in both files mean signals' options.__e
// wrapper changes nothing about error routing.
//
// Finding this control produced: preact-iso's ErrorBoundary does NOT catch
// plain errors. Its options.__e only intercepts thenables (`err.then`); a plain
// throw falls through to the previous handler, and `ErrorBoundary`'s own
// `componentDidCatch = props.onError` is not reached on an initial-render
// throw. That is true with and without signals loaded.
import { Component, type VNode } from 'preact';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/preact';
import { lazy, ErrorBoundary } from 'preact-iso';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CONTROL (no signals in graph)', () => {
  it('ErrorBoundary catches a suspend and resumes it', async () => {
    let release!: (v: { default: () => VNode }) => void;
    const pending = new Promise<{ default: () => VNode }>((r) => {
      release = r;
    });
    const onError = vi.fn();
    const Lazy = lazy(() => pending);

    render(
      <ErrorBoundary onError={onError}>
        <Lazy />
      </ErrorBoundary>
    );

    expect(screen.queryByTestId('ctl-resumed')).toBeNull();

    await act(async () => {
      release({ default: () => <p data-testid="ctl-resumed">ok</p> });
      await pending;
    });

    await waitFor(() => expect(screen.getByTestId('ctl-resumed')).toBeTruthy());
    expect(onError).not.toHaveBeenCalled();
  });

  it('a plain error reaches a class componentDidCatch', async () => {
    const caught = vi.fn();

    class Boundary extends Component<{ children?: unknown }, { bad: boolean }> {
      state = { bad: false };
      componentDidCatch(err: unknown) {
        caught(err);
        this.setState({ bad: true });
      }
      render() {
        return this.state.bad ? (
          <p data-testid="ctl-caught">caught</p>
        ) : (
          (this.props.children as VNode)
        );
      }
    }

    function Boom(): VNode {
      throw new Error('boom');
    }

    render(
      <Boundary>
        <Boom />
      </Boundary>
    );

    await waitFor(() => expect(screen.getByTestId('ctl-caught')).toBeTruthy());
    expect((caught.mock.calls[0][0] as Error).message).toBe('boom');
  });
});
