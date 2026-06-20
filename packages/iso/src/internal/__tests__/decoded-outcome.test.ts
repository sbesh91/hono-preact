import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyDecodedOutcome,
  crossOriginRedirectMessage,
  type OutcomeSink,
} from '../decoded-outcome.js';
import { timeoutMessage } from '../timeout.js';

// Control the same-origin vs cross-origin decision deterministically, without a
// real window.location.assign.
vi.mock('../safe-redirect.js', () => ({
  assignSafeRedirect: vi.fn(),
}));
import { assignSafeRedirect } from '../safe-redirect.js';
const assignSafeRedirectMock = vi.mocked(assignSafeRedirect);

function spySink() {
  return {
    success: vi.fn(),
    navigated: vi.fn(),
    crossOriginRedirect: vi.fn(),
    deny: vi.fn(),
    error: vi.fn(),
    timeout: vi.fn(),
    unknown: vi.fn(),
    malformed: vi.fn(),
  } satisfies OutcomeSink;
}

// Every dispatch must call exactly one sink method.
function assertOnlyCalled(
  sink: ReturnType<typeof spySink>,
  name: keyof OutcomeSink
) {
  for (const key of Object.keys(sink) as (keyof OutcomeSink)[]) {
    if (key === name) expect(sink[key]).toHaveBeenCalledTimes(1);
    else expect(sink[key]).not.toHaveBeenCalled();
  }
}

describe('applyDecodedOutcome', () => {
  beforeEach(() => assignSafeRedirectMock.mockReset());

  it('dispatches success and returns not-navigated', () => {
    const sink = spySink();
    const navigated = applyDecodedOutcome(
      { kind: 'success', data: { a: 1 } },
      sink
    );
    expect(navigated).toBe(false);
    expect(sink.success).toHaveBeenCalledWith({ a: 1 });
    assertOnlyCalled(sink, 'success');
  });

  it('dispatches deny with status/message/data', () => {
    const sink = spySink();
    applyDecodedOutcome(
      { kind: 'deny', status: 403, message: 'nope', data: { why: 1 } },
      sink
    );
    expect(sink.deny).toHaveBeenCalledWith(403, 'nope', { why: 1 });
    assertOnlyCalled(sink, 'deny');
  });

  it('dispatches error', () => {
    const sink = spySink();
    applyDecodedOutcome({ kind: 'error', message: 'boom' }, sink);
    expect(sink.error).toHaveBeenCalledWith('boom');
    assertOnlyCalled(sink, 'error');
  });

  it('dispatches timeout with the canonical message', () => {
    const sink = spySink();
    applyDecodedOutcome({ kind: 'timeout', timeoutMs: 5000 }, sink);
    expect(sink.timeout).toHaveBeenCalledWith(5000, timeoutMessage(5000));
    assertOnlyCalled(sink, 'timeout');
  });

  it('dispatches unknown with outcome and message', () => {
    const sink = spySink();
    applyDecodedOutcome(
      { kind: 'unknown', outcome: 'weird', message: 'msg' },
      sink
    );
    expect(sink.unknown).toHaveBeenCalledWith('weird', 'msg');
    assertOnlyCalled(sink, 'unknown');
  });

  it('dispatches malformed with the http status', () => {
    const sink = spySink();
    applyDecodedOutcome({ kind: 'malformed', httpStatus: 502 }, sink);
    expect(sink.malformed).toHaveBeenCalledWith(502);
    assertOnlyCalled(sink, 'malformed');
  });

  it('same-origin redirect: navigates and returns true', () => {
    assignSafeRedirectMock.mockReturnValue(true);
    const sink = spySink();
    const navigated = applyDecodedOutcome(
      { kind: 'redirect', to: '/next' },
      sink
    );
    expect(navigated).toBe(true);
    expect(assignSafeRedirectMock).toHaveBeenCalledWith('/next');
    assertOnlyCalled(sink, 'navigated');
  });

  it('cross-origin redirect: refuses with the shared message, returns false', () => {
    assignSafeRedirectMock.mockReturnValue(false);
    const sink = spySink();
    const navigated = applyDecodedOutcome(
      { kind: 'redirect', to: 'https://evil.example' },
      sink
    );
    expect(navigated).toBe(false);
    expect(sink.crossOriginRedirect).toHaveBeenCalledWith(
      crossOriginRedirectMessage('https://evil.example')
    );
    assertOnlyCalled(sink, 'crossOriginRedirect');
  });
});

describe('crossOriginRedirectMessage', () => {
  it('names the refused target and the same-origin requirement', () => {
    const msg = crossOriginRedirectMessage('https://evil.example/x');
    expect(msg).toContain('https://evil.example/x');
    expect(msg).toContain('same-origin');
  });
});
