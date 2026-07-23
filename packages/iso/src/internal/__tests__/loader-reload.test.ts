// @vitest-environment happy-dom
// The reload state machine, driven directly with a fake write surface and no
// renderer. Before extraction this logic could only be reached by mounting a
// <Loader>, calling reload() through context, and inferring the sequence from
// what re-rendered. Here the phase transitions and the in-flight/queue
// bookkeeping are asserted straight off the session.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { createLoaderSession } from '../loader-session.js';
import type { LoaderPhaseOps } from '../loader-readers.js';
import { runReload, requestReload } from '../loader-reload.js';
import type { LoaderPhase } from '../../loader-state.js';

const LOC = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

/** A recording write surface. `setPhase` resolves updater functions so phase
 * transitions can be asserted as concrete values. */
function recordingOps<T>(): LoaderPhaseOps<T> & {
  phase: LoaderPhase<T>;
  readonly log: string[];
} {
  const rec = {
    phase: { tag: 'loading' } as LoaderPhase<T>,
    log: [] as string[],
    setPhase(next: LoaderPhase<T> | ((p: LoaderPhase<T>) => LoaderPhase<T>)) {
      rec.phase = typeof next === 'function' ? next(rec.phase) : next;
      rec.log.push(`phase:${rec.phase.tag}`);
    },
    setStatus(s: string) {
      rec.log.push(`status:${s}`);
    },
    setError() {
      rec.log.push('error');
    },
    applyChunk() {
      rec.log.push('chunk');
    },
    subscribeAccumulate() {
      rec.log.push('subscribe');
      return new Promise<T>(() => {});
    },
  };
  return rec as LoaderPhaseOps<T> & {
    phase: LoaderPhase<T>;
    readonly log: string[];
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('requestReload: queue guard', () => {
  it('runs immediately when idle', () => {
    const session = createLoaderSession<number>();
    const run = vi.fn();
    session.runReload = run;

    requestReload(session);

    expect(run).toHaveBeenCalledTimes(1);
    expect(session.queuedReload).toBe(false);
  });

  it('queues instead of running when a reload is in flight', () => {
    const session = createLoaderSession<number>();
    const run = vi.fn();
    session.runReload = run;
    session.inFlight = true;

    requestReload(session);

    expect(run).not.toHaveBeenCalled();
    expect(session.queuedReload).toBe(true);
  });
});

describe('runReload: entry transition', () => {
  it('revalidates over a settled value, retaining it', () => {
    const session = createLoaderSession<number>();
    const ops = recordingOps<number>();
    ops.phase = { tag: 'success', value: 5 };
    // A never-resolving fetch so we observe only the synchronous entry step.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const ref = defineLoader<number>(async () => 0, { __moduleKey: 'm' });

    runReload({
      session,
      ops,
      loaderRef: ref,
      currentLocation: () => LOC,
      id: 'r1',
    });

    expect(ops.phase).toEqual({ tag: 'revalidating', value: 5 });
    expect(session.inFlight).toBe(true);
    expect(session.bakedDeny).toBeNull();
  });

  it('falls back to a cold loading when there is no value to retain', () => {
    const session = createLoaderSession<number>();
    const ops = recordingOps<number>();
    ops.phase = { tag: 'loading' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const ref = defineLoader<number>(async () => 0, { __moduleKey: 'm' });

    runReload({
      session,
      ops,
      loaderRef: ref,
      currentLocation: () => LOC,
      id: 'r2',
    });

    expect(ops.phase).toEqual({ tag: 'loading' });
    expect(session.inFlight).toBe(true);
  });

  it('revalidates over a preload/cache value carried on session.sync', () => {
    // The structural-presence path: the phase is still `loading` but a value was
    // adopted on `sync`, so a reload must revalidate, not cold-load.
    const session = createLoaderSession<number>();
    session.sync = { present: true, value: 9 };
    const ops = recordingOps<number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const ref = defineLoader<number>(async () => 0, { __moduleKey: 'm' });

    runReload({
      session,
      ops,
      loaderRef: ref,
      currentLocation: () => LOC,
      id: 'r3',
    });

    expect(ops.phase).toEqual({ tag: 'revalidating', value: 9 });
  });
});

describe('runReload: settle drains the queue', () => {
  it('runs a reload that was queued while the fetch was in flight', async () => {
    const session = createLoaderSession<number>();
    const ops = recordingOps<number>();
    // Resolve immediately so the .then settle path runs.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('42', { status: 200 }))
    );
    const ref = defineLoader<number>(async () => 0, { __moduleKey: 'm' });

    let runs = 0;
    const deps = {
      session,
      ops,
      loaderRef: ref,
      currentLocation: () => LOC,
      id: 'r4',
    };
    session.runReload = () => {
      runs++;
      if (runs === 1) {
        runReload(deps);
        // Queue a second reload while the first is in flight.
        session.queuedReload = true;
      }
    };

    session.runReload();
    await vi.waitFor(() => expect(runs).toBe(2));

    expect(session.inFlight).toBe(false);
  });
});

describe('runReload: streaming reload', () => {
  it('sets connecting and resubscribes for an accumulate loader', () => {
    const session = createLoaderSession<number>();
    const ops = recordingOps<number>();
    // eslint-disable-next-line require-yield
    const ref = defineLoader<number>(async function* () {}, {
      __moduleKey: 'm',
    });

    runReload({
      session,
      ops,
      loaderRef: ref,
      currentLocation: () => LOC,
      id: 'r5',
      accumulate: { initial: 0, reduce: (_a, c) => c as number },
    });

    expect(ops.log).toContain('status:connecting');
    expect(ops.log).toContain('subscribe');
    expect(session.inFlight).toBe(true);
  });
});
