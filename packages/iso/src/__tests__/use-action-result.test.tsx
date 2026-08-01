// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { ActionResultContext } from '../action-result-context.js';
import { useActionResult } from '../use-action-result.js';
import {
  setLastActionResult,
  clearLastActionResult,
} from '../internal/action-result-store.js';

function Reader({ stub }: { stub?: { __module: string; __action: string } }) {
  const r = useActionResult(stub as never);
  return <pre>{JSON.stringify(r.value)}</pre>;
}

afterEach(() => {
  cleanup();
  clearLastActionResult('pages/foo.server', 'submit');
});

describe('useActionResult', () => {
  it('returns a ReadonlySignal that is null when no provider', () => {
    const { container } = render(<Reader />);
    expect(container.textContent).toBe('null');
  });

  it('returns the deny result with submittedPayload', () => {
    const value = {
      module: 'pages/foo.server',
      action: 'submit',
      kind: 'deny' as const,
      status: 422,
      message: 'bad',
      data: { fieldErrors: { x: ['nope'] } },
      submittedPayload: { text: 'hi' },
    };
    const { container } = render(
      <ActionResultContext.Provider value={value}>
        <Reader />
      </ActionResultContext.Provider>
    );
    expect(JSON.parse(container.textContent!)).toMatchObject({
      kind: 'deny',
      status: 422,
      message: 'bad',
      data: { fieldErrors: { x: ['nope'] } },
      submittedPayload: { text: 'hi' },
    });
  });

  it('filters by stub identity when stub passed', () => {
    const value = {
      module: 'pages/foo.server',
      action: 'submit',
      kind: 'success' as const,
      data: { id: 1 },
      submittedPayload: { x: 1 },
    };
    const { container } = render(
      <ActionResultContext.Provider value={value}>
        <Reader stub={{ __module: 'pages/other.server', __action: 'submit' }} />
      </ActionResultContext.Provider>
    );
    expect(container.textContent).toBe('null');
  });

  it('returns the success result with submittedPayload', () => {
    const value = {
      module: 'pages/foo.server',
      action: 'submit',
      kind: 'success' as const,
      data: { id: 7 },
      submittedPayload: { text: 'yes' },
    };
    const { container } = render(
      <ActionResultContext.Provider value={value}>
        <Reader />
      </ActionResultContext.Provider>
    );
    expect(JSON.parse(container.textContent!)).toEqual({
      kind: 'success',
      data: { id: 7 },
      submittedPayload: { text: 'yes' },
    });
  });

  it('returns the error result and accepts null submittedPayload', () => {
    const value = {
      module: 'pages/foo.server',
      action: 'submit',
      kind: 'error' as const,
      message: 'boom',
      submittedPayload: null,
    };
    const { container } = render(
      <ActionResultContext.Provider value={value}>
        <Reader />
      </ActionResultContext.Provider>
    );
    expect(JSON.parse(container.textContent!)).toEqual({
      kind: 'error',
      message: 'boom',
      submittedPayload: null,
    });
  });

  it('reads JS-on results from the client store (no SSR provider)', () => {
    setLastActionResult('pages/foo.server', 'submit', {
      kind: 'deny',
      status: 422,
      message: 'bad',
      data: { fieldErrors: { x: ['nope'] } },
      submittedPayload: { text: 'hi' },
    });
    const { container } = render(
      <Reader stub={{ __module: 'pages/foo.server', __action: 'submit' }} />
    );
    expect(JSON.parse(container.textContent!)).toMatchObject({
      kind: 'deny',
      status: 422,
      message: 'bad',
    });
  });

  it('client store wins when both SSR provider and store are present', () => {
    setLastActionResult('pages/foo.server', 'submit', {
      kind: 'success',
      data: { fromClient: true },
      submittedPayload: null,
    });
    const ssrValue = {
      module: 'pages/foo.server',
      action: 'submit',
      kind: 'deny' as const,
      status: 422,
      message: 'from ssr',
      submittedPayload: null,
    };
    const { container } = render(
      <ActionResultContext.Provider value={ssrValue}>
        <Reader stub={{ __module: 'pages/foo.server', __action: 'submit' }} />
      </ActionResultContext.Provider>
    );
    const parsed = JSON.parse(container.textContent!);
    expect(parsed.kind).toBe('success');
    expect(parsed.data).toEqual({ fromClient: true });
  });

  it('granularity: a binding that reads `.value` updates without the host re-rendering', async () => {
    const stub = { __module: 'pages/foo.server', __action: 'submit' };
    const renders = { host: 0, binding: 0 };

    function Binding() {
      renders.binding++;
      const result = useActionResult(stub as never);
      return <pre data-testid="binding">{JSON.stringify(result.value)}</pre>;
    }
    function Host() {
      renders.host++;
      return <Binding />;
    }

    render(<Host />);
    expect(screen.getByTestId('binding').textContent).toBe('null');
    const hostBefore = renders.host;

    await act(async () => {
      setLastActionResult('pages/foo.server', 'submit', {
        kind: 'success',
        data: { ok: true },
        submittedPayload: null,
      });
    });

    // The binding picked up the fresh value...
    expect(JSON.parse(screen.getByTestId('binding').textContent)).toMatchObject(
      { kind: 'success', data: { ok: true } }
    );
    // ...but the HOST never re-rendered: only the signal-subscribed leaf did
    // (Preact's per-component signal tracking, not a top-down re-render).
    expect(renders.host).toBe(hostBefore);
  });
});

// T1 (review round 3). `defineAction` attaches `__module`/`__action` only when
// the Vite `moduleKeyPlugin` injected them (`action.ts:152-153` guards both with
// `!== undefined`), so a stub from an unprocessed module carries NEITHER.
//
// The hooks derived a `ref` from those two fields and then keyed every decision
// off `ref`, which collapses "no stub was passed" and "a stub was passed but has
// no identity" into the same branch. The first legitimately means "any action";
// the second must mean "nothing", because the caller named an action and we
// cannot tell which. On `main` the identity guard tested `stub` (the object), so
// this returned null.
describe('T1: a stub with no injected identity matches NOTHING', () => {
  it("does not adopt another action's result", () => {
    setLastActionResult('pages/other.server', 'submit', {
      kind: 'deny',
      status: 422,
      message: 'Task deleted',
      submittedPayload: {},
    });
    // A stub object, but the plugin never rewrote it.
    const unrewritten = {} as { __module: string; __action: string };
    const { container } = render(<Reader stub={unrewritten} />);
    // Under the defect this rendered the OTHER action's deny message: a signup
    // form showing "Task deleted".
    expect(container.textContent).toBe('null');
    clearLastActionResult('pages/other.server', 'submit');
  });

  it('CONTROL: no stub at all still reports the most recent result', () => {
    // The no-stub fallback is a designed feature ("the last action result on
    // this page"), so the fix must not break it. This is what stops the test
    // above from passing against a hook that simply returns null always.
    setLastActionResult('pages/other.server', 'submit', {
      kind: 'deny',
      status: 422,
      message: 'Task deleted',
      submittedPayload: {},
    });
    const { container } = render(<Reader />);
    expect(container.textContent).toContain('Task deleted');
    clearLastActionResult('pages/other.server', 'submit');
  });

  it('CONTROL: a properly keyed stub still matches its own result', () => {
    setLastActionResult('pages/foo.server', 'submit', {
      kind: 'deny',
      status: 422,
      message: 'Name required',
      submittedPayload: {},
    });
    const { container } = render(
      <Reader stub={{ __module: 'pages/foo.server', __action: 'submit' }} />
    );
    expect(container.textContent).toContain('Name required');
  });
});

// The mirror has to FOLLOW the stub, including when it appears or disappears.
// `<Form action={mode === 'edit' ? updateTodo : undefined}>` is the shape: a
// reader that latched `given` at mount keeps answering for the wrong branch,
// and in the no-stub-then-unrewritten-stub direction that is the T1 leak again.
describe('T1: the any-action fallback follows a stub that appears or vanishes', () => {
  it('stops reporting another action once an unkeyed stub is supplied', () => {
    setLastActionResult('pages/other.server', 'submit', {
      kind: 'deny',
      status: 422,
      message: 'Task deleted',
      submittedPayload: {},
    });
    const { container, rerender } = render(<Reader />);
    // No stub: the designed any-action fallback.
    expect(container.textContent).toContain('Task deleted');

    const unrewritten = {} as { __module: string; __action: string };
    rerender(<Reader stub={unrewritten} />);
    expect(container.textContent).toBe('null');
    clearLastActionResult('pages/other.server', 'submit');
  });

  it('resumes the any-action fallback when the stub goes away', () => {
    setLastActionResult('pages/other.server', 'submit', {
      kind: 'deny',
      status: 422,
      message: 'Task deleted',
      submittedPayload: {},
    });
    const unrewritten = {} as { __module: string; __action: string };
    const { container, rerender } = render(<Reader stub={unrewritten} />);
    expect(container.textContent).toBe('null');

    rerender(<Reader />);
    expect(container.textContent).toContain('Task deleted');
    clearLastActionResult('pages/other.server', 'submit');
  });
});
