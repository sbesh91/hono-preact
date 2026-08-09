import { useContext } from 'preact/hooks';
import { useComputed, useSignal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { ActionResultContext } from './action-result-context.js';
import {
  lastActionResultSignal,
  pickLastActionResult,
  type StoredActionResult,
} from './internal/action-result-store.js';
import { isBrowser } from './is-browser.js';
import type { ActionRef } from './action.js';
import type { Serialize } from './internal/serialize.js';
import { useStubKey } from './internal/use-stub-key.js';
import type { DenyRecord } from './internal/deny-record.js';
import { readValidationIssues } from './internal/validation-issues.js';

export type ActionResult<TPayload, TResult> =
  | { kind: 'success'; data: Serialize<TResult>; submittedPayload: TPayload }
  | (DenyRecord & {
      kind: 'deny';
      /**
       * The payload as parsed from the request. For form submissions, this is
       * a `Record<string, FormDataEntryValue | FormDataEntryValue[]>` where
       * each value is a string or File (never a parsed primitive like `number`
       * or `boolean`). The `TPayload` typing reflects the dev-declared shape,
       * not the runtime structural shape. Read individual fields knowing they
       * arrive as form-data entries.
       */
      submittedPayload: TPayload;
    })
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
    // `issues` is populated from the SAME reserved key `getValidationIssues`
    // reads, so the two agree by construction; the store itself is untouched,
    // type-erased, and still carries the bag under `data` for that reader and
    // for `<FieldError>`. Surfacing it as its own field here is what keeps the
    // deny variant's shape identical to `mutate`'s deny arm.
    const issues = readValidationIssues(source.data);
    return {
      kind: 'deny',
      status: source.status,
      message: source.message,
      data: source.data,
      ...(source.code !== undefined ? { code: source.code } : {}),
      ...(issues ? { issues } : {}),
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
 * reporting the previous action's result. The context value is mirrored for the
 * same reason: `ActionResultContext` is a PUBLIC export, so an app can provide
 * it on the client and update it, and a plain capture would pin this reader to
 * whatever was provided on the mount render.
 */
export function useActionResult<TPayload = unknown, TResult = unknown>(
  stub?: ActionRef<TPayload, TResult, never>
): ReadonlySignal<ActionResult<TPayload, TResult>> {
  // Mirrored, not captured. A same-reference write is a no-op (signals dedupe
  // by `===`), so the SSR case -- one value for the whole page render -- costs
  // nothing, while a client-side provider update is actually followed.
  const ssrValue = useContext(ActionResultContext);
  const ssr = useSignal(ssrValue);
  ssr.value = ssrValue;
  const stubKey = useStubKey(stub);

  // Two-stage projection. The inner computed yields the STORED ENTRY, whose
  // identity the store preserves across writes keyed to other actions, so
  // signals-core's `!==` dedupe absorbs them. Only the outer computed builds
  // the fresh `ActionResult` object, and it re-evaluates only when THIS
  // reader's own entry actually changed. Projecting out of a single computed
  // would bump the computed's version on every store write (a fresh literal is
  // never `===` the previous one) and re-render every binding on the page.
  const entry = useComputed(() => {
    const { ref, unmatchable } = stubKey.value;
    // A stub was passed but carries no identity, so nothing can honestly be
    // attributed to it. Without this, `ref` is `undefined` and the lookup falls
    // through to the any-action branch, handing this reader whatever unrelated
    // action wrote last.
    if (unmatchable) return null;
    const client = isBrowser()
      ? pickLastActionResult(lastActionResultSignal.value, ref)
      : null;
    // Client store wins when populated: a JS-on submit has produced a result.
    // SSR context is the fallback for the PE deny re-render path (no JS state).
    const source = client ?? ssr.value;
    if (!source) return null;
    if (
      ref &&
      (source.module !== ref.__module || source.action !== ref.__action)
    ) {
      return null;
    }
    return source;
  });
  return useComputed(() =>
    entry.value ? projectActionResult<TPayload, TResult>(entry.value) : null
  );
}
