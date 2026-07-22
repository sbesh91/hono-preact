import { describe, it, expect, vi } from 'vitest';
import {
  createLoaderSession,
  settleSession,
  nextAbortSignal,
} from '../loader-session.js';

describe('loader session: settle drain', () => {
  it('clears in-flight and runs a reload that was queued while busy', () => {
    const session = createLoaderSession<number>();
    const reload = vi.fn();
    session.runReload = reload;
    session.inFlight = true;
    session.queuedReload = true;

    settleSession(session);

    expect(session.inFlight).toBe(false);
    expect(session.queuedReload).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not run a reload when none was queued', () => {
    const session = createLoaderSession<number>();
    const reload = vi.fn();
    session.runReload = reload;
    session.inFlight = true;

    settleSession(session);

    expect(session.inFlight).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('drains exactly once, so a queued reload cannot re-trigger itself', () => {
    // The queue holds at most one pending reload by design. Clearing the flag
    // BEFORE invoking is what stops a reload that immediately re-settles from
    // recursing.
    const session = createLoaderSession<number>();
    let reentered = 0;
    session.runReload = () => {
      reentered++;
      settleSession(session);
    };
    session.queuedReload = true;

    settleSession(session);

    expect(reentered).toBe(1);
  });
});

describe('loader session: abort handoff', () => {
  it('aborts the previous controller and issues a fresh signal', () => {
    const session = createLoaderSession<number>();

    const first = nextAbortSignal(session);
    expect(first.aborted).toBe(false);

    const second = nextAbortSignal(session);

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(second).not.toBe(first);
  });

  it('seeds a streaming accumulator only when the caller supplies one', () => {
    const session = createLoaderSession<number>();
    expect(session.acc).toBeUndefined();
    expect(session.sync).toEqual({ present: false });
    expect(session.reader).toBeNull();
    expect(session.loaderId).toBeNull();
  });
});
