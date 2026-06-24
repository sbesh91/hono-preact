import { useCallback, useRef, useState } from 'preact/hooks';
import type { Context } from 'hono';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { AnyLoaderRef } from './define-loader.js';
import { useInvalidate } from './use-invalidate.js';
import type { ActionUse } from './internal/use-types.js';
import { beginSubmit, endSubmit } from './internal/form-submit-store.js';
import {
  setLastActionResult,
  type StoredActionResult,
} from './internal/action-result-store.js';
import { decodeActionResponse } from './internal/action-envelope.js';
import { applyDecodedOutcome } from './internal/decoded-outcome.js';
import { validateTimeoutMs, timeoutMessage } from './internal/timeout.js';
import type { Serialize } from './internal/serialize.js';
import { FORM_MODULE_FIELD, FORM_ACTION_FIELD } from './internal/contract.js';

export type ActionRef<TPayload, TResult, TChunk = never> = {
  readonly __module: string;
  readonly __action: string;
  readonly __phantom?: readonly [TPayload, TResult, TChunk];
  useAction<TSnapshot = unknown>(
    options?: UseActionOptions<TPayload, TResult, TChunk, TSnapshot>
  ): UseActionResult<TPayload, TResult>;
};

export type ActionCtx = {
  c: Context;
  signal: AbortSignal;
};

export type ActionFn<TPayload, TResult, TChunk = never> =
  | ((ctx: ActionCtx, payload: TPayload) => Promise<TResult>)
  | ((ctx: ActionCtx, payload: TPayload) => Promise<ReadableStream<TChunk>>)
  | ((
      ctx: ActionCtx,
      payload: TPayload
    ) => AsyncGenerator<TChunk, TResult, unknown>);

export type DefineActionOptions<TChunk = never, TResult = unknown> = {
  /**
   * Per-action middleware and (for streaming actions) stream observers.
   * Attached to the function as a non-enumerable property; the
   * page-actions-handler reads it through the typed `ActionEntry` map built at
   * module-load time (`packages/server/src/page-actions-handler.ts`).
   */
  use?: ActionUse<TChunk, TResult, boolean>;
  /**
   * Per-action timeout in milliseconds. When omitted, the handler applies
   * its configured default (30s). Pass `false` to disable the timeout for
   * this action.
   */
  timeoutMs?: number | false;
  /**
   * The module key the client-side `useAction` hook will reference in its
   * RPC envelope. Production wires this through the Vite plugin's
   * client-stub emission; test code can pass it directly to construct a
   * properly-shaped stub without bypassing the type system.
   */
  __module?: string;
  /** The action name the client-side `useAction` hook will reference. */
  __action?: string;
  /**
   * Standard Schema validating the action payload. When provided, the handler
   * receives the schema's validated output (`InferOutput`) and the client-facing
   * stub's payload type is the same `InferOutput`. The server enforces it before
   * the handler runs; a failure becomes `deny(422)` with issues. The framework
   * does not coerce, the schema does (e.g. `z.coerce.number()`).
   */
  input?: StandardSchemaV1;
};

export class TimeoutError extends Error {
  readonly kind = 'timeout' as const;
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(timeoutMessage(timeoutMs));
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function defineAction<
  TInput extends StandardSchemaV1,
  TResult,
  TChunk = never,
>(
  fn: ActionFn<StandardSchemaV1.InferOutput<TInput>, TResult, TChunk>,
  opts: DefineActionOptions<TChunk, TResult> & { input: TInput }
): ActionRef<StandardSchemaV1.InferOutput<TInput>, TResult, TChunk>;
export function defineAction<TPayload, TResult, TChunk = never>(
  fn: ActionFn<TPayload, TResult, TChunk>,
  opts?: DefineActionOptions<TChunk, TResult>
): ActionRef<TPayload, TResult, TChunk>;
export function defineAction(
  // `unknown` widens the impl to accept all overloads; the permissive types are
  // bounded here and do not escape to callers (each overload narrows them).
  fn: ActionFn<unknown, unknown, unknown>,
  opts?: DefineActionOptions<unknown, unknown>
): ActionRef<unknown, unknown, unknown> {
  validateTimeoutMs(opts?.timeoutMs, 'defineAction');
  // SHAPE NOTE: `ActionRef` describes the CLIENT-side shape produced by the
  // Vite plugin (`packages/vite/src/server-only.ts`) — an object with
  // `__module`, `__action`, and a `useAction` method. `defineAction` runs on
  // the SERVER side and returns the raw function with metadata attached via
  // `Object.defineProperty`. These are two different runtime shapes unified
  // under one type so consumers can import a server action and use it
  // identically on both sides; the plugin handles the substitution at the
  // value level. The `as unknown as` cast at the return is the single
  // bounded acknowledgement of this dual-shape contract. A future cleanup
  // could split into `ServerActionImpl` / `ActionRef` types if the lie
  // starts to bite, but for now it's localized and documented.
  //
  // `Object.defineProperty` is used instead of direct assignment so a frozen
  // module export (strict ESM, HMR-frozen modules) does not throw.
  // The key union pins the form-field constants to the typed ActionRef
  // property names at compile time; a divergence fails here, not at runtime.
  const attach = (
    key: 'use' | 'timeoutMs' | '__module' | '__action' | 'input',
    value: unknown
  ) => {
    Object.defineProperty(fn, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  };
  if (opts?.use) attach('use', opts.use);
  if (opts?.timeoutMs !== undefined) attach('timeoutMs', opts.timeoutMs);
  if (opts?.input) attach('input', opts.input);
  if (opts?.__module !== undefined) attach(FORM_MODULE_FIELD, opts.__module);
  if (opts?.__action !== undefined) attach(FORM_ACTION_FIELD, opts.__action);
  return fn as unknown as ActionRef<unknown, unknown, unknown>;
}

type UseActionOptionsCommon<TChunk = never> = {
  /**
   * How to update loader caches after the action commits. Three modes:
   *
   * - `'auto'`: re-RUN the active page's loader (the one wrapping this
   *   `useAction` call). Triggers a real fetch through `/__loaders` — it
   *   is NOT a no-op even when nothing observable changed. Equivalent to
   *   calling `useReload().reload()` from `onSuccess`.
   * - `false` (default): do nothing.
   * - An array of `LoaderRef`s: call `.invalidate()` on each (clear cache
   *   only; no immediate refetch). If the active page's loader is in the
   *   array, ALSO re-run it.
   *
   * See `/docs/reloading` for the full mental model.
   */
  invalidate?: 'auto' | false | ReadonlyArray<AnyLoaderRef>;
  // Chunks arrive over the wire as JSON, so the client sees `Serialize<TChunk>`.
  onChunk?: (chunk: Serialize<TChunk>) => void;
};

/**
 * Options when `onMutate` is provided. `onSuccess` / `onError` receive the
 * value `onMutate` returned for this specific mutation as the second
 * parameter, so concurrent calls can be paired with their own snapshot.
 */
type UseActionWithMutate<TPayload, TResult, TChunk, TSnapshot> =
  UseActionOptionsCommon<TChunk> & {
    onMutate: (payload: TPayload) => TSnapshot;
    onError?: (err: Error, snapshot: TSnapshot) => void;
    onSuccess?: (data: Serialize<TResult>, snapshot: TSnapshot) => void;
  };

/**
 * Options when `onMutate` is not provided. `onSuccess` / `onError` take
 * only the result / error — there is no snapshot to thread through.
 */
type UseActionWithoutMutate<TResult, TChunk> =
  UseActionOptionsCommon<TChunk> & {
    onMutate?: undefined;
    onError?: (err: Error) => void;
    onSuccess?: (data: Serialize<TResult>) => void;
  };

/**
 * Discriminated by `onMutate`. Providing `onMutate` requires the
 * `onSuccess` / `onError` callbacks to accept the snapshot; omitting
 * `onMutate` types those callbacks as single-argument.
 */
export type UseActionOptions<
  TPayload,
  TResult,
  TChunk = never,
  TSnapshot = unknown,
> =
  | UseActionWithMutate<TPayload, TResult, TChunk, TSnapshot>
  | UseActionWithoutMutate<TResult, TChunk>;

/**
 * The value `mutate` resolves to. A discriminated union so callers can
 * chain on success without awaiting then probing the hook's `data`/`error`
 * state, and without leaking unhandled rejections in fire-and-forget callers.
 *
 * - Success: `{ ok: true, data }`. `data` is `undefined` for streaming
 *   actions that close without emitting a `result` SSE event (the type
 *   reflects this honestly: callers must narrow before using `data`).
 * - Failure: `{ ok: false, error }`. The same `Error` instance is also
 *   written to the hook's `error` state and passed to `onError`.
 */
export type MutateResult<TResult> =
  | { ok: true; data: Serialize<TResult> | undefined }
  | { ok: false; error: Error };

export type UseActionResult<TPayload, TResult> = {
  mutate: (payload: TPayload) => Promise<MutateResult<TResult>>;
  pending: boolean;
  error: Error | null;
  data: Serialize<TResult> | null;
};

function recordOutcome(
  module: string,
  action: string,
  result: StoredActionResult
): void {
  setLastActionResult(module, action, result);
}

function hasFileValues(payload: unknown): boolean {
  if (typeof File === 'undefined') return false;
  if (typeof payload !== 'object' || payload === null) return false;
  return Object.values(payload as Record<string, unknown>).some(
    (v) => v instanceof File
  );
}

export function useAction<
  TPayload,
  TResult,
  TChunk = never,
  TSnapshot = unknown,
>(
  stub: ActionRef<TPayload, TResult, TChunk>,
  options?: UseActionOptions<TPayload, TResult, TChunk, TSnapshot>
): UseActionResult<TPayload, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // The hook surfaces the wire value (`Serialize<TResult>`), not the
  // server-side `TResult`: the result was JSON round-tripped to reach here.
  const [data, setData] = useState<Serialize<TResult> | null>(null);
  const applyInvalidate = useInvalidate();

  const stubRef = useRef(stub);
  stubRef.current = stub;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mutate = useCallback(
    async (payload: TPayload): Promise<MutateResult<TResult>> => {
      setPending(true);
      setError(null);

      const currentStub = stubRef.current;
      const currentOptions = optionsRef.current;

      // Resolve the callback discriminant once for this mutation. The runtime
      // value `callbacks` carries the typed onSuccess/onError handlers plus
      // the snapshot (when onMutate is set) so subsequent invokeSuccess /
      // invokeError calls don't need to re-narrow currentOptions.
      type Callbacks =
        | {
            kind: 'with-mutate';
            snapshot: TSnapshot;
            onSuccess?: (data: Serialize<TResult>, snapshot: TSnapshot) => void;
            onError?: (err: Error, snapshot: TSnapshot) => void;
          }
        | {
            kind: 'without-mutate';
            onSuccess?: (data: Serialize<TResult>) => void;
            onError?: (err: Error) => void;
          };

      const callbacks: Callbacks = currentOptions?.onMutate
        ? {
            kind: 'with-mutate',
            snapshot: currentOptions.onMutate(payload),
            onSuccess: currentOptions.onSuccess,
            onError: currentOptions.onError,
          }
        : {
            kind: 'without-mutate',
            onSuccess: currentOptions?.onSuccess,
            onError: currentOptions?.onError,
          };

      const invokeSuccess = (data: Serialize<TResult>) => {
        if (callbacks.kind === 'with-mutate') {
          callbacks.onSuccess?.(data, callbacks.snapshot);
        } else {
          callbacks.onSuccess?.(data);
        }
      };
      const invokeError = (err: Error) => {
        if (callbacks.kind === 'with-mutate') {
          callbacks.onError?.(err, callbacks.snapshot);
        } else {
          callbacks.onError?.(err);
        }
      };

      const target =
        typeof window !== 'undefined'
          ? window.location.pathname + window.location.search
          : '/';

      let finalResult: Serialize<TResult> | undefined;
      // Tracks whether a branch has already written to the action-result store.
      // The outer catch writes for unclassified errors (network failures, parse
      // errors) only when no branch has already recorded the outcome.
      let outcomeRecorded = false;
      beginSubmit(currentStub.__module, currentStub.__action);
      try {
        let response: Response;
        if (hasFileValues(payload)) {
          const fd = new FormData();
          fd.append(FORM_MODULE_FIELD, currentStub.__module);
          fd.append(FORM_ACTION_FIELD, currentStub.__action);
          for (const [key, value] of Object.entries(
            payload as Record<string, unknown>
          )) {
            if (key === FORM_MODULE_FIELD || key === FORM_ACTION_FIELD)
              continue;
            if (value instanceof File) {
              fd.append(key, value);
            } else if (typeof value === 'string') {
              fd.append(key, value);
            } else {
              fd.append(key, JSON.stringify(value));
            }
          }
          response = await fetch(target, {
            method: 'POST',
            headers: { Accept: 'application/json, text/event-stream;q=0.9' },
            body: fd,
          });
        } else {
          response = await fetch(target, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream;q=0.9',
            },
            body: JSON.stringify({
              module: currentStub.__module,
              action: currentStub.__action,
              payload,
            }),
          });
        }

        const contentType = response.headers.get('Content-Type') ?? '';
        if (contentType.includes('text/event-stream') && response.body) {
          const { readSSE } = await import('./internal/sse-decoder.js');
          let resultValue: Serialize<TResult> | undefined;
          let streamError: Error | null = null;
          for await (const ev of readSSE(response.body)) {
            if (ev.event === 'message') {
              try {
                currentOptions?.onChunk?.(
                  JSON.parse(ev.data) as Serialize<TChunk>
                );
              } catch {
                // malformed JSON in stream: skip
              }
            } else if (ev.event === 'result') {
              try {
                resultValue = JSON.parse(ev.data) as Serialize<TResult>;
              } catch (e) {
                streamError = new Error(
                  `Malformed result event in stream: ${e instanceof Error ? e.message : String(e)}`
                );
              }
            } else if (ev.event === 'timeout') {
              try {
                const parsed = JSON.parse(ev.data) as { timeoutMs?: number };
                streamError = new TimeoutError(parsed.timeoutMs ?? 0);
              } catch (e) {
                streamError = new Error(
                  `Malformed timeout event in stream: ${e instanceof Error ? e.message : String(e)}`
                );
              }
            } else if (ev.event === 'error') {
              try {
                const parsed = JSON.parse(ev.data) as {
                  message?: string;
                  name?: string;
                };
                streamError = new Error(parsed.message ?? 'Streamed error');
                if (parsed.name) streamError.name = parsed.name;
              } catch (e) {
                streamError = new Error(
                  `Malformed error event in stream: ${e instanceof Error ? e.message : String(e)}`
                );
              }
            }
          }

          if (streamError) {
            recordOutcome(currentStub.__module, currentStub.__action, {
              kind: 'error',
              message: streamError.message,
              submittedPayload: payload,
            });
            outcomeRecorded = true;
            throw streamError;
          }
          if (resultValue !== undefined) {
            setData(resultValue);
            invokeSuccess(resultValue);
            finalResult = resultValue;
            recordOutcome(currentStub.__module, currentStub.__action, {
              kind: 'success',
              data: resultValue,
              submittedPayload: payload,
            });
            outcomeRecorded = true;
          } else {
            // Streaming action closed without emitting a `result` event;
            // resolve with `data: undefined`. `onSuccess` is not called
            // in this branch since there is no result value to deliver
            // (matches the static-action path where onSuccess only fires
            // with a real value).
            finalResult = undefined;
          }
        } else {
          // Uniform envelope path. All non-streaming responses carry a JSON
          // body shaped as { __outcome, ... } regardless of HTTP status.
          // Failures throw to the surrounding catch (which sets `error`/`data`
          // and returns `{ ok: false }`); success falls through to
          // `applyInvalidate` below; a same-origin redirect parks forever.
          const decoded = await decodeActionResponse(response);
          const navigated = applyDecodedOutcome(decoded, {
            success: (data) => {
              const result = data as Serialize<TResult>;
              setData(result);
              invokeSuccess(result);
              finalResult = result;
              recordOutcome(currentStub.__module, currentStub.__action, {
                kind: 'success',
                data: result,
                submittedPayload: payload,
              });
              outcomeRecorded = true;
            },
            navigated: () => {},
            crossOriginRedirect: (message) => {
              throw new Error(message);
            },
            deny: (status, message, data) => {
              recordOutcome(currentStub.__module, currentStub.__action, {
                kind: 'deny',
                status,
                message,
                data,
                submittedPayload: payload,
              });
              outcomeRecorded = true;
              throw new Error(message);
            },
            error: (message) => {
              recordOutcome(currentStub.__module, currentStub.__action, {
                kind: 'error',
                message,
                submittedPayload: payload,
              });
              outcomeRecorded = true;
              throw new Error(message);
            },
            timeout: (timeoutMs, message) => {
              recordOutcome(currentStub.__module, currentStub.__action, {
                kind: 'error',
                message,
                submittedPayload: payload,
              });
              outcomeRecorded = true;
              throw new TimeoutError(timeoutMs);
            },
            unknown: (outcome) => {
              throw new Error(`Unknown action outcome: ${outcome}`);
            },
            malformed: (httpStatus) => {
              throw new Error(`Malformed envelope (HTTP ${httpStatus})`);
            },
          });
          if (navigated) {
            // Same-origin redirect issued; this promise never settles.
            return await new Promise<MutateResult<TResult>>(() => {});
          }
        }

        applyInvalidate(currentOptions?.invalidate);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        // Write to the store only for unclassified errors (network failures,
        // parse errors). Per-branch errors set outcomeRecorded before throwing.
        if (!outcomeRecorded) {
          recordOutcome(currentStub.__module, currentStub.__action, {
            kind: 'error',
            message: e.message,
            submittedPayload: payload,
          });
        }
        setError(e);
        invokeError(e);
        setPending(false);
        return { ok: false, error: e };
      } finally {
        endSubmit(currentStub.__module, currentStub.__action);
      }
      setPending(false);
      return { ok: true, data: finalResult };
    },
    []
  );

  return { mutate, pending, error, data };
}
