import { signal, computed } from '@preact/signals';
import {
  registerPresenceReactiveImpl,
  registerLoaderReactiveImpl,
  type ReadonlyReactive,
  type PhaseCell,
} from './internal/reactive.js';
import { createSignalRoster } from './internal/roster-signal.js';

/**
 * The opt-in signals entry (the `hono-preact/signals` subpath). Importing this
 * module installs the signal-backed roster: `member(id)` becomes a per-member
 * signal, so a presence update patches one bound row instead of re-rendering
 * every consumer. This is the ONLY module that imports `@preact/signals`; apps
 * that never import it pay no signal bytes.
 */

/** Register the signal-backed roster. Called on import; exported so a test can
 * re-install after clearing the registration. */
export function installPresenceSignals(): void {
  registerPresenceReactiveImpl({
    createRoster: <S>() => createSignalRoster<S>(),
  });
}

/**
 * The signal-backed loader implementation: `createPhaseCell` is a `Signal`, and
 * `derive` is a `computed`. Reading a derived signal in a component subscribes
 * that component, so a `useFieldSignal` node updates alone when its field
 * changes, without the loader host re-rendering it.
 */
export function installLoaderSignals(): void {
  registerLoaderReactiveImpl({
    createPhaseCell: <T>(initial: T): PhaseCell<T> => {
      const s = signal(initial);
      return {
        set(value) {
          s.value = value;
        },
        source: s,
      };
    },
    derive: <T, R>(source: ReadonlyReactive<T>, select: (v: T) => R) =>
      computed(() => select(source.value)),
  });
}

installPresenceSignals();
installLoaderSignals();
