import { useContext } from 'preact/hooks';
import { useStoreSnapshot } from './internal/use-store-snapshot.js';
import { ActionResultContext } from './action-result-context.js';
import {
  getLastActionResult,
  subscribeLastActionResult,
  type StoredActionResult,
} from './internal/action-result-store.js';
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

export function useActionResult<TPayload = unknown, TResult = unknown>(
  stub?: ActionRef<TPayload, TResult, never>
): ActionResult<TPayload, TResult> {
  const ssr = useContext(ActionResultContext);
  const client = useStoreSnapshot(subscribeLastActionResult, () =>
    isBrowser() ? getLastActionResult(stub) : null
  );

  // Client store wins when populated: a JS-on submit has produced a result.
  // SSR context is the fallback for the PE deny re-render path (no JS state).
  const source = client ?? ssr;
  if (!source) return null;
  if (
    stub &&
    (source.module !== stub.__module || source.action !== stub.__action)
  ) {
    return null;
  }
  return projectActionResult<TPayload, TResult>(source);
}
