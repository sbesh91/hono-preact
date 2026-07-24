import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from '../define-loader.js';
import { isBrowser } from '../is-browser.js';
import { runLoader } from './loader-runner.js';
import { resolveCurrentValue } from '../loader-state.js';
import { serializeLocationForCache } from './cache-key.js';
import {
  abandonReload,
  nextAbortSignal,
  settleSession,
  type LoaderSession,
} from './loader-session.js';
import type { LoaderPhaseOps } from './loader-readers.js';
import type { AccumulateOptions } from './use-loader-runner.js';

/**
 * Everything a reload needs, none of it a hook. `ops` is the same write surface
 * the reader factories use (`loader-readers.ts`), which is what lets the reload
 * state machine and the readers stay in agreement about how the phase moves:
 * there is one way to write the phase and both go through it.
 *
 * `currentLocation` is a thunk, not a value, because a reload must use the
 * location as of when it runs, not as of when the machine was wired. On the
 * client a reload can fire long after the render that built it.
 */
export type ReloadDeps<T> = {
  session: LoaderSession<T>;
  ops: LoaderPhaseOps<T>;
  loaderRef: LoaderRef<T, boolean>;
  currentLocation: () => RouteHook;
  id: string;
  accumulate?: AccumulateOptions;
};

/**
 * Run a reload NOW, unconditionally. The queue guard lives in `requestReload`;
 * by the time this runs the decision to reload has been made.
 *
 * Both terminal branches funnel through the session drains: `settleSession` on
 * success (which runs a reload queued while this one was in flight) and
 * `abandonReload` on failure (which drops it). Those two helpers are the only
 * place the in-flight/queue bookkeeping is touched, so the success and failure
 * paths cannot drift apart.
 */
export function runReload<T>(deps: ReloadDeps<T>): void {
  const { session, ops, loaderRef, currentLocation, id, accumulate } = deps;

  // A reload supersedes the SSR-baked deny: drop the seed so the view projects
  // from the real phase (loading -> success/coldError) as the refetch runs.
  session.bakedDeny = null;
  session.inFlight = true;

  // Enter `revalidating` retaining the prior value (stale-while-revalidate);
  // with NO settled value fall back to a cold `loading`. Presence is
  // STRUCTURAL: the phase carries a value, OR a preload/cache value was adopted
  // on `session.sync` (a preload/cache-hydrated loader keeps its phase at
  // `loading` while its value lives on `sync`). NOT `prior !== undefined`, so a
  // reload over a settled-`undefined` value still revalidates (review #2/#3).
  ops.setPhase((p) => {
    const current = resolveCurrentValue(p, session.sync);
    return current.present
      ? { tag: 'revalidating', value: current.value }
      : { tag: 'loading' };
  });

  if (accumulate) {
    // Streaming/live reload = resubscribe: `subscribeAccumulate` aborts the
    // current stream (via its own abort), resets to `initial`, reopens, and
    // folds chunks through `reduce`. Drive status connecting -> open/closed/
    // error, mirroring a fresh mount. `revalidating` keeps `reloading` true
    // until the first chunk lands.
    ops.setStatus('connecting');
    ops
      .subscribeAccumulate(nextAbortSignal(session))
      .then((firstChunk) => {
        // applyChunk moves the phase to `success` (clears reloading).
        ops.applyChunk(firstChunk);
        settleSession(session);
      })
      .catch((err: unknown) => {
        ops.setError(err);
        ops.setStatus('error');
        abandonReload(session);
      });
    return;
  }

  // Read `currentLocation()` freshly at each cache write, not once up front, so
  // the behaviour matches the pre-extraction runner exactly: an in-flight
  // single-value reload caches its result under whatever the location is when
  // the value lands.
  const promise: Promise<T> = runLoader<T>(
    loaderRef,
    currentLocation(),
    id,
    nextAbortSignal(session),
    {
      onChunk: (value) => {
        ops.setPhase({ tag: 'success', value });
        if (isBrowser()) {
          loaderRef.cache.set(
            value,
            serializeLocationForCache(currentLocation(), loaderRef.params)
          );
        }
      },
      onError: (err) => ops.setError(err),
      onEnd: () => {
        /* nothing to do */
      },
    }
  );

  promise
    .then((result) => {
      if (isBrowser())
        loaderRef.cache.set(
          result,
          serializeLocationForCache(currentLocation(), loaderRef.params)
        );
      // A fresh `success` per settle (clears reloading); `result` may be
      // `undefined`, which is a real state change here (review #10).
      ops.setPhase({ tag: 'success', value: result });
      settleSession(session);
    })
    .catch((err: unknown) => {
      ops.setError(err);
      abandonReload(session);
    });
}

/**
 * The public reload entry: run now, or mark one queued if a reload/fetch is
 * already in flight. At most one reload is ever queued; `settleSession` drains
 * it when the in-flight one finishes. `session.runReload` is the bound
 * `() => runReload(deps)` the hook installs each render, so the queued drain and
 * a streaming re-entry both reach a reload through the session, never through a
 * captured closure.
 */
export function requestReload<T>(session: LoaderSession<T>): void {
  if (session.inFlight) {
    session.queuedReload = true;
    return;
  }
  session.runReload();
}
