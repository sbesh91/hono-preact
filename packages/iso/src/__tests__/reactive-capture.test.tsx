// @vitest-environment happy-dom
//
// Two instances of "a reactive input captured wrong", from an earlier review.
// Both have the same shape as defects this branch already fixed twice
// (`useOptimistic`'s `base`/`reducer`, `useFormStatus`'s `stub`): a value that
// can change is read into a `useComputed` closure, which only re-evaluates when
// a TRACKED signal moves, so the change is never seen.
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/preact';
import { LoaderDataProvider } from '../internal/loader-data-provider.js';
import { LoaderDataContext } from '../internal/contexts.js';
import { ActionResultContext } from '../action-result-context.js';
import { useActionResult } from '../use-action-result.js';
import { OptimisticOverlay } from '../internal/optimistic-overlay.js';
import type { ActionResultContextValue } from '../action-result-context.js';
import { useContext } from 'preact/hooks';

afterEach(cleanup);

// The SSR context carries the action's identity alongside the outcome, so the
// hook can tell whether a result belongs to the stub the caller passed.
const deny = (message: string): ActionResultContextValue => ({
  module: 'm',
  action: 'a',
  kind: 'deny',
  status: 422,
  message,
  submittedPayload: {},
});

describe('useActionResult tracks the ActionResultContext value', () => {
  it('picks up a provider value change', async () => {
    function Read() {
      const r = useActionResult().value;
      return <p data-testid="msg">{r?.kind === 'deny' ? r.message : 'none'}</p>;
    }
    const { rerender } = render(
      <ActionResultContext.Provider value={deny('FIRST')}>
        <Read />
      </ActionResultContext.Provider>
    );
    expect(screen.getByTestId('msg').textContent).toBe('FIRST');

    // `ActionResultContext` is a PUBLIC export, so an app can provide it on the
    // client and update it. The hook must follow.
    await act(async () => {
      rerender(
        <ActionResultContext.Provider value={deny('SECOND')}>
          <Read />
        </ActionResultContext.Provider>
      );
    });
    expect(screen.getByTestId('msg').textContent).toBe('SECOND');
  });
});

describe('OptimisticOverlay does not churn the loader channel', () => {
  it('passes the host arm through UNCHANGED when nothing is pending', () => {
    // With no pending actions the projection IS the base, so re-providing a
    // freshly spread `{...ctx, data: projected}` publishes a new object with
    // identical contents. `LoaderDataProvider`'s signal notifies on it, and
    // every `loader.useData()` consumer below re-renders for nothing.
    const host = { status: 'success' as const, data: { n: 1 } };
    let seen: unknown = null;
    function Peek() {
      seen = useContext(LoaderDataContext)?.value;
      return null;
    }
    render(
      <LoaderDataProvider state={host}>
        <OptimisticOverlay
          loader={{} as never}
          reducer={(base: { n: number }) => base}
          pending={[]}
        >
          <Peek />
        </OptimisticOverlay>
      </LoaderDataProvider>
    );
    // Identity, not deep-equality: identity is what the provider's signal
    // compares, so it is what decides whether consumers are woken.
    expect(seen).toBe(host);
  });

  it('still projects a new arm when something IS pending', () => {
    const host = { status: 'success' as const, data: { n: 1 } };
    let seen: unknown = null;
    function Peek() {
      seen = useContext(LoaderDataContext)?.value;
      return null;
    }
    render(
      <LoaderDataProvider state={host}>
        <OptimisticOverlay
          loader={{} as never}
          reducer={(base: { n: number }, a: number) => ({ n: base.n + a })}
          pending={[5]}
        >
          <Peek />
        </OptimisticOverlay>
      </LoaderDataProvider>
    );
    expect(seen).not.toBe(host);
    expect((seen as { data: unknown }).data).toEqual({ n: 6 });
  });
});
