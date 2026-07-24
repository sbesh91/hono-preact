import {
  registerPresenceReactiveImpl,
  registerLoaderReactiveImpl,
} from './internal/reactive.js';
import { createSignalRoster } from './internal/roster-signal.js';
import { createPhaseCell, derive } from './internal/loader-signal.js';

/**
 * The opt-in signals entry (the `hono-preact/signals` subpath). Importing this
 * module registers the signal-backed roster and loader implementations against
 * `internal/reactive.js`'s registration seam, so `useRoom` and the loader hooks
 * pick up the granular, per-binding update behaviour those factories provide.
 * It is a thin wrapper: the actual `@preact/signals` usage lives in the
 * data-layer factory modules it imports (`internal/roster-signal.js`,
 * `internal/loader-signal.js`), which the always-on `useRoom` / loader path
 * already imports directly.
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
  registerLoaderReactiveImpl({ createPhaseCell, derive });
}

installPresenceSignals();
installLoaderSignals();
