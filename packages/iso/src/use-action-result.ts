import { useContext } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import { ActionResultContext } from './action-result-context.js';
import {
  lastActionResultSignal,
  pickLastActionResult,
  type StoredActionResult,
} from './internal/action-result-store.js';
import { useStoreState, useStoreValue } from './internal/store-signal.js';
import { isBrowser } from './is-browser.js';
import type { ActionRef } from './action.js';
import type { Serialize } from './internal/serialize.js';
import type { DenyCode } from './outcomes.js';

export type ActionResult<TPayload, TResult> =
  | { kind: 'success'; data: Serialize<TResult>; submittedPayload: TPayload }
  | {
      kind: 'deny';
      status: number;
      message: string;
      data?: unknown;
      code?: DenyCode;
      /**
       * The payload as parsed from the request. For form submissions, this is
       * a `Record<string, FormDataEntryValue | FormDataEntryValue[]>` where
       * each value is a string or File (never a parsed primitive like `number`
       * or `boolean`). The `TPayload` typing reflects the dev-declared shape,
       * not the runtime structural shape. Read individual fields knowing they
       * arrive as form-data entries.
       */
      submittedPayload: TPayload;
    }
  | {
      kind: 'error';
      message: string;
      submittedPayload: TPayload | null;
    }
  | null;

// The single structural-read boundary for action results. Both the client
// store and the SSR context hold results type-erased (`unknown` payload/data):
// one channel carries every action's results keyed by module/action, so neither
// can know a given reader's `TPayload`/`TResult`. `useActionResult`'s generics
// are the only place the intended shape is declared, so this accessor re-applies
// them here in one guarded spot rather than scattering `as TPayload` across the
// hook body. `submittedPayload` is the dev-declared shape, not the runtime
// structural shape (form submissions arrive as form-data entries); see the
// `ActionResult` deny variant's note.
function projectActionResult<TPayload, TResult>(
  source: StoredActionResult
): ActionResult<TPayload, TResult> {
  if (source.kind === 'success') {
    return {
      kind: 'success',
      data: source.data as Serialize<TResult>,
      submittedPayload: source.submittedPayload as TPayload,
    };
  }
  if (source.kind === 'deny') {
    return {
      kind: 'deny',
      status: source.status,
      message: source.message,
      data: source.data,
      ...(source.code !== undefined ? { code: source.code } : {}),
      submittedPayload: source.submittedPayload as TPayload,
    };
  }
  return {
    kind: 'error',
    message: source.message,
    submittedPayload: source.submittedPayload as TPayload | null,
  };
}

/**
 * Reactive read: `useComputed` tracks `lastActionResultSignal`, so a binding
 * that reads `.value` updates on a fresh action result without the host
 * component re-rendering. `useComputed` refreshes its closure each render but
 * only re-evaluates when a TRACKED signal changes, so `stub` is mirrored into
 * tracked signals below rather than merely captured -- a call site that swaps
 * actions (`mode === 'create' ? createTodo : updateTodo`) must not keep
 * reporting the previous action's result. The SSR context value is still a
 * plain capture: it is set once per page render and never changes after.
 */
export function useActionResult<TPayload = unknown, TResult = unknown>(
  stub?: ActionRef<TPayload, TResult, never>
): ReadonlySignal<ActionResult<TPayload, TResult>> {
  const ssr = useContext(ActionResultContext);
  // Mirror the stub's IDENTITY (two primitive strings, so a fresh object
  // literal per render is a no-op write) into tracked signals. The computed
  // below is created once (`useComputed` is `useMemo(..., [])`) and only
  // re-evaluates when a tracked signal changes, so a plain closure capture of
  // `stub` would pin this reader to the action passed on the mount render.
  const stubModule = useStoreState<string | undefined>(stub?.__module);
  const stubAction = useStoreState<string | undefined>(stub?.__action);
  stubModule.set(stub?.__module);
  stubAction.set(stub?.__action);

  // Two-stage projection. The inner computed yields the STORED ENTRY, whose
  // identity the store preserves across writes keyed to other actions, so
  // signals-core's `!==` dedupe absorbs them. Only the outer computed builds
  // the fresh `ActionResult` object, and it re-evaluates only when THIS
  // reader's own entry actually changed. Projecting out of a single computed
  // would bump the computed's version on every store write (a fresh literal is
  // never `===` the previous one) and re-render every binding on the page.
  const entry = useStoreValue(() => {
    const module = stubModule.signal.value;
    const action = stubAction.signal.value;
    const ref =
      module !== undefined && action !== undefined
        ? { __module: module, __action: action }
        : undefined;
    const client = isBrowser()
      ? pickLastActionResult(lastActionResultSignal.value, ref)
      : null;
    // Client store wins when populated: a JS-on submit has produced a result.
    // SSR context is the fallback for the PE deny re-render path (no JS state).
    const source = client ?? ssr;
    if (!source) return null;
    if (
      ref &&
      (source.module !== ref.__module || source.action !== ref.__action)
    ) {
      return null;
    }
    return source;
  });
  return useStoreValue(() =>
    entry.value ? projectActionResult<TPayload, TResult>(entry.value) : null
  );
}
