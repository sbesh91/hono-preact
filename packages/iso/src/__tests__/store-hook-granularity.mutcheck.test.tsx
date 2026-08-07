// @vitest-environment happy-dom
// P1-11 mutation check. The two tests titled "granularity:" in
// `use-form-status.test.tsx` and `use-action-result.test.tsx` assert
// `renders.host` -- the PARENT of the hook caller -- which no hook
// implementation can ever re-render. They therefore pass against a granular
// implementation, a non-granular one, and pre-PR code alike.
//
// These are the tests that DO discriminate, written in the shape the branch
// already uses correctly elsewhere (`field-errors-granularity.test.tsx:104-112`,
// `internal/__tests__/use-room-signals-granularity.test.tsx:132`): assert the
// render count of an UNRELATED SIBLING reader across a store write that must
// not affect it.
import { describe, expect, it, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/preact';
import { useFormStatus } from '../use-form-status.js';
import { useActionResult } from '../use-action-result.js';
import { beginSubmit, endSubmit } from '../internal/form-submit-store.js';
import {
  setLastActionResult,
  clearLastActionResult,
} from '../internal/action-result-store.js';

const stubA = { __module: 'pages/a.server', __action: 'submit' };
const stubB = { __module: 'pages/b.server', __action: 'submit' };

afterEach(() => {
  cleanup();
  endSubmit(stubA.__module, stubA.__action);
  endSubmit(stubB.__module, stubB.__action);
  clearLastActionResult(stubA.__module, stubA.__action);
  clearLastActionResult(stubB.__module, stubB.__action);
});

describe('P1-11 store-hook granularity (sibling readers)', () => {
  it('useFormStatus: a submit on stub A does not re-render the stub-B reader', () => {
    const renders = { a: 0, b: 0 };

    function StatusA() {
      renders.a++;
      const s = useFormStatus(stubA as never);
      return (
        <span data-testid="a">{s.value.pending ? 'pending' : 'idle'}</span>
      );
    }
    function StatusB() {
      renders.b++;
      const s = useFormStatus(stubB as never);
      return (
        <span data-testid="b">{s.value.pending ? 'pending' : 'idle'}</span>
      );
    }

    render(
      <>
        <StatusA />
        <StatusB />
      </>
    );
    expect(screen.getByTestId('a').textContent).toBe('idle');
    expect(screen.getByTestId('b').textContent).toBe('idle');
    const aBefore = renders.a;
    const bBefore = renders.b;

    act(() => beginSubmit(stubA.__module, stubA.__action));

    // A's own binding must have updated...
    expect(screen.getByTestId('a').textContent).toBe('pending');
    expect(renders.a).toBeGreaterThan(aBefore);
    // ...and B, whose pending-ness did NOT change, must not have re-rendered.
    expect(screen.getByTestId('b').textContent).toBe('idle');
    expect(renders.b).toBe(bBefore);
  });

  it('useActionResult: a result for stub A does not re-render the stub-B reader', async () => {
    const renders = { a: 0, b: 0 };

    function ResultA() {
      renders.a++;
      const r = useActionResult(stubA as never);
      return <pre data-testid="a">{JSON.stringify(r.value)}</pre>;
    }
    function ResultB() {
      renders.b++;
      const r = useActionResult(stubB as never);
      return <pre data-testid="b">{JSON.stringify(r.value)}</pre>;
    }

    render(
      <>
        <ResultA />
        <ResultB />
      </>
    );
    expect(screen.getByTestId('a').textContent).toBe('null');
    expect(screen.getByTestId('b').textContent).toBe('null');
    const aBefore = renders.a;
    const bBefore = renders.b;

    await act(async () => {
      setLastActionResult(stubA.__module, stubA.__action, {
        kind: 'success',
        data: { ok: true },
        submittedPayload: null,
      });
    });

    expect(JSON.parse(screen.getByTestId('a').textContent!)).toMatchObject({
      kind: 'success',
    });
    expect(renders.a).toBeGreaterThan(aBefore);
    // B's projection still resolves to `null`; it must not have re-rendered.
    expect(screen.getByTestId('b').textContent).toBe('null');
    expect(renders.b).toBe(bBefore);
  });

  it('useActionResult: a result for stub A does not re-render a stub-B reader that ALREADY has a result', async () => {
    // The `null`-sibling case above is the EASY one: `null === null`, so
    // `computed`'s dedupe holds whatever the projection does. The real case is a
    // sibling that already holds a result, because `projectActionResult` builds
    // a FRESH object on every recompute, so `===` can never hold and the
    // dedupe is defeated exactly as it was in `useFormStatus`.
    const renders = { a: 0, b: 0 };

    function ResultA() {
      renders.a++;
      const r = useActionResult(stubA as never);
      return <pre data-testid="a">{JSON.stringify(r.value)}</pre>;
    }
    function ResultB() {
      renders.b++;
      const r = useActionResult(stubB as never);
      return <pre data-testid="b">{JSON.stringify(r.value)}</pre>;
    }

    // Seed B BEFORE mounting so its projection is a real object, not `null`.
    setLastActionResult(stubB.__module, stubB.__action, {
      kind: 'success',
      data: { b: 1 },
      submittedPayload: null,
    });

    render(
      <>
        <ResultA />
        <ResultB />
      </>
    );
    expect(screen.getByTestId('a').textContent).toBe('null');
    expect(JSON.parse(screen.getByTestId('b').textContent!)).toMatchObject({
      kind: 'success',
      data: { b: 1 },
    });
    const aBefore = renders.a;
    const bBefore = renders.b;

    await act(async () => {
      setLastActionResult(stubA.__module, stubA.__action, {
        kind: 'success',
        data: { a: 1 },
        submittedPayload: null,
      });
    });

    expect(JSON.parse(screen.getByTestId('a').textContent!)).toMatchObject({
      kind: 'success',
      data: { a: 1 },
    });
    expect(renders.a).toBeGreaterThan(aBefore);
    // B's own result is untouched; it must not have re-rendered.
    expect(JSON.parse(screen.getByTestId('b').textContent!)).toMatchObject({
      kind: 'success',
      data: { b: 1 },
    });
    expect(renders.b).toBe(bBefore);
  });
});
