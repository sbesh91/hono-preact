// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { ActionResultContext } from '../action-result-context.js';
import { useActionResult } from '../use-action-result.js';

function Reader({ stub }: { stub?: { __module: string; __action: string } }) {
  const r = useActionResult(stub as never);
  return <pre>{JSON.stringify(r)}</pre>;
}

describe('useActionResult', () => {
  it('returns null when no provider', () => {
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
});
