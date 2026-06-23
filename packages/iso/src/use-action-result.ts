import { useContext } from 'preact/hooks';
import { ActionResultContext } from './action-result-context.js';
import {
  getLastActionResult,
  subscribeActionResults,
} from './internal/action-result-store.js';
import { useStoreSnapshot } from './internal/use-store-snapshot.js';
import { isBrowser } from './is-browser.js';
import type { ActionStub } from './action.js';
import type { Serialize } from './internal/serialize.js';

export type ActionResult<TPayload, TResult> =
  | { kind: 'success'; data: Serialize<TResult>; submittedPayload: TPayload }
  | {
      kind: 'deny';
      status: number;
      message: string;
      data?: unknown;
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

export function useActionResult<TPayload = unknown, TResult = unknown>(
  stub?: ActionStub<TPayload, TResult, never>
): ActionResult<TPayload, TResult> {
  const ssr = useContext(ActionResultContext);
  const client = useStoreSnapshot(subscribeActionResults, () =>
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
      submittedPayload: source.submittedPayload as TPayload,
    };
  }
  return {
    kind: 'error',
    message: source.message,
    submittedPayload: source.submittedPayload as TPayload | null,
  };
}
