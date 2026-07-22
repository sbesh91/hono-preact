/**
 * SPIKE (throwaway): the opt-in module from §6 of
 * `docs/superpowers/specs/2026-07-21-first-party-signals-design.md`. The real
 * one would be the `hono-preact/signals` subpath export; this is the same idea
 * under a name that marks it disposable.
 *
 * Importing this module is what installs signal-backed reactivity. Core never
 * references it, so an app that does not import it pays nothing and the loader
 * runner keeps its `useState` path bit-for-bit.
 */
import { signal, computed, type ReadonlySignal } from '@preact/signals';
import { useContext, useRef } from 'preact/hooks';
import { registerReactiveImpl, type Cell } from './internal/reactive-cell.js';
import { LoaderViewSignalContext } from './internal/contexts.js';
import type { RunnerView } from './internal/use-loader-runner.js';
import type { LoaderState } from './loader-state.js';

/**
 * Install signal-backed reactivity. Exported so a test can restore it after
 * deliberately deregistering; a bare `await import()` cannot, because the
 * module is cached and its import-time side effect does not run twice.
 */
export function installSignalReactivity(): void {
  registerReactiveImpl({
    cell: <T>(initial: T): Cell<T> => {
      const s = signal(initial);
      return {
        // peek(), never .value: the runner reads the phase during render and
        // must not subscribe the component that owns the hook.
        peek: () => s.peek(),
        set: (next) => {
          s.value =
            typeof next === 'function'
              ? (next as (prev: T) => T)(s.peek())
              : next;
        },
        source: s,
      };
    },
    derive: <T>(compute: () => T) => computed(compute),
  });
}

// Installed at import time, matching the deferred-install finding: this may run
// after the app has booted, as long as it runs before the loaders that should
// be signal-backed first mount.
installSignalReactivity();

/**
 * The loader's state as a signal. Returns a signal of `null` when no signal
 * implementation is active for this loader (no provider, or a streaming
 * `accumulate` loader, which this spike does not cover).
 *
 * Additive: `.View()` and `.useData()` are untouched and keep working.
 */
export function useDataSignal<T>(): ReadonlySignal<LoaderState<T> | null> {
  // Reading a context whose value core types structurally as `{ value:
  // unknown }` is the sanctioned cast boundary; core cannot name RunnerView
  // and a Signal in the same place without importing signals.
  const viewSignal = useContext(LoaderViewSignalContext) as {
    readonly value: RunnerView<T>;
  } | null;

  const ref = useRef<ReadonlySignal<LoaderState<T> | null> | null>(null);
  if (ref.current === null) {
    ref.current = computed(() => {
      if (!viewSignal) return null;
      const view = viewSignal.value;
      // A cold error routes to the boundary, not to a value; report null.
      if (view.kind !== 'render') return null;
      return view.state as LoaderState<T>;
    });
  }
  return ref.current;
}

/**
 * A projection of the loader's data. This is the row-level ergonomic: bind the
 * returned signal into JSX (`{title}`, NOT `{title.value}`) and only that text
 * node updates when the field changes.
 */
export function useFieldSignal<T, R>(
  select: (data: T) => R,
  fallback: R
): ReadonlySignal<R> {
  const state = useDataSignal<T>();
  const ref = useRef<ReadonlySignal<R> | null>(null);
  if (ref.current === null) {
    ref.current = computed(() => {
      const s = state.value;
      // Value-presence stays structural: only the `loading` arm lacks `data`.
      if (!s || s.status === 'loading') return fallback;
      return select(s.data);
    });
  }
  return ref.current;
}
