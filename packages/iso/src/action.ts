import { useCallback, useContext, useRef, useState } from 'preact/hooks';
import type { Context } from 'hono';
import { ReloadContext } from './reload-context.js';
import { ActiveLoaderIdContext } from './internal/contexts.js';
import type { LoaderRef } from './define-loader.js';
import type { ActionUse } from './internal/use-types.js';

export type ActionStub<TPayload, TResult, TChunk = never> = {
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

export type DefineActionOpts<TChunk = never, TResult = unknown> = {
  /**
   * Per-action middleware and (for streaming actions) stream observers.
   * Attached to the function as a non-enumerable property; the
   * actions-handler reads it through the typed `ActionEntry` map built at
   * module-load time (`packages/server/src/actions-handler.ts`).
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
};

export class TimeoutError extends Error {
  readonly kind = 'timeout' as const;
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function validateTimeoutMs(
  value: number | false | undefined,
  context: string
): void {
  if (value === undefined || value === false) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${context}: timeoutMs must be a non-negative finite number or false, got ${String(value)}`
    );
  }
}

export function defineAction<TPayload, TResult, TChunk = never>(
  fn: ActionFn<TPayload, TResult, TChunk>,
  opts?: DefineActionOpts<TChunk, TResult>
): ActionStub<TPayload, TResult, TChunk> {
  validateTimeoutMs(opts?.timeoutMs, 'defineAction');
  // SHAPE NOTE: `ActionStub` describes the CLIENT-side shape produced by the
  // Vite plugin (`packages/vite/src/server-only.ts`) — an object with
  // `__module`, `__action`, and a `useAction` method. `defineAction` runs on
  // the SERVER side and returns the raw function with metadata attached via
  // `Object.defineProperty`. These are two different runtime shapes unified
  // under one type so consumers can import a server action and use it
  // identically on both sides; the plugin handles the substitution at the
  // value level. The `as unknown as` cast at the return is the single
  // bounded acknowledgement of this dual-shape contract. A future cleanup
  // could split into `ServerActionImpl` / `ActionStub` types if the lie
  // starts to bite, but for now it's localized and documented.
  //
  // `Object.defineProperty` is used instead of direct assignment so a frozen
  // module export (strict ESM, HMR-frozen modules) does not throw.
  const attach = (key: string, value: unknown) => {
    Object.defineProperty(fn, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  };
  if (opts?.use) attach('use', opts.use);
  if (opts?.timeoutMs !== undefined) attach('timeoutMs', opts.timeoutMs);
  if (opts?.__module !== undefined) attach('__module', opts.__module);
  if (opts?.__action !== undefined) attach('__action', opts.__action);
  return fn as unknown as ActionStub<TPayload, TResult, TChunk>;
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
  invalidate?: 'auto' | false | ReadonlyArray<LoaderRef<unknown>>;
  onChunk?: (chunk: TChunk) => void;
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
    onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
  };

/**
 * Options when `onMutate` is not provided. `onSuccess` / `onError` take
 * only the result / error — there is no snapshot to thread through.
 */
type UseActionWithoutMutate<TResult, TChunk> =
  UseActionOptionsCommon<TChunk> & {
    onMutate?: undefined;
    onError?: (err: Error) => void;
    onSuccess?: (data: TResult) => void;
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
  | { ok: true; data: TResult | undefined }
  | { ok: false; error: Error };

export type UseActionResult<TPayload, TResult> = {
  mutate: (payload: TPayload) => Promise<MutateResult<TResult>>;
  pending: boolean;
  error: Error | null;
  data: TResult | null;
};

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
  stub: ActionStub<TPayload, TResult, TChunk>,
  options?: UseActionOptions<TPayload, TResult, TChunk, TSnapshot>
): UseActionResult<TPayload, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TResult | null>(null);
  const reloadCtx = useContext(ReloadContext);
  const activeLoaderId = useContext(ActiveLoaderIdContext);

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
            onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
            onError?: (err: Error, snapshot: TSnapshot) => void;
          }
        | {
            kind: 'without-mutate';
            onSuccess?: (data: TResult) => void;
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

      const invokeSuccess = (data: TResult) => {
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

      let finalResult: TResult | undefined;
      try {
        let response: Response;
        if (hasFileValues(payload)) {
          const fd = new FormData();
          fd.append('__module', currentStub.__module);
          fd.append('__action', currentStub.__action);
          for (const [key, value] of Object.entries(
            payload as Record<string, unknown>
          )) {
            if (key === '__module' || key === '__action') continue;
            if (value instanceof File) {
              fd.append(key, value);
            } else if (typeof value === 'string') {
              fd.append(key, value);
            } else {
              fd.append(key, JSON.stringify(value));
            }
          }
          response = await fetch('/__actions', { method: 'POST', body: fd });
        } else {
          response = await fetch('/__actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              module: currentStub.__module,
              action: currentStub.__action,
              payload,
            }),
          });
        }

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            __outcome?: string;
            message?: string;
            timeoutMs?: number;
          };
          if (
            body.__outcome === 'timeout' &&
            typeof body.timeoutMs === 'number'
          ) {
            throw new TimeoutError(body.timeoutMs);
          }
          // Deny outcomes carry `message` instead of the legacy `error`
          // field; prefer the descriptive message when present. The deny()
          // constructor defaults the message for first-party callers, but a
          // hand-rolled envelope from custom server middleware might still
          // ship without one; fall back to a deny-aware label so the user
          // sees a hint that the status came from an explicit deny rather
          // than a generic transport failure.
          let msg: string;
          if (body.__outcome === 'deny') {
            msg =
              typeof body.message === 'string'
                ? body.message
                : `Request denied (${response.status})`;
          } else {
            msg = body.error ?? `Action failed with status ${response.status}`;
          }
          throw new Error(msg);
        }

        const contentType = response.headers.get('Content-Type') ?? '';
        // Server-side middleware that throws `redirect(...)` comes back as
        // a redirect outcome envelope. Hand off to the browser; the rest of
        // this promise will never settle, but the page is navigating away
        // anyway.
        //
        // Trust boundary: `to` is taken straight from the JSON body and
        // passed to `window.location.assign`. The framework's own handlers
        // emit safe (typically same-origin) values, but a compromised or
        // misconfigured server (or a proxy injecting JSON) could push the
        // client anywhere. We don't validate origin here for v0.1; treat
        // your own server as part of the trusted boundary. A same-origin
        // check is a deferred enhancement (see C4 in the middleware review).
        //
        // We use `response.clone().json()` to peek at the body without
        // consuming it: if the response is NOT a redirect outcome the
        // downstream `await response.json()` still needs to read it. Clone
        // is cheap on a small JSON payload.
        if (!contentType.includes('text/event-stream')) {
          const peek = (await response
            .clone()
            .json()
            .catch(() => undefined)) as unknown;
          if (
            peek !== null &&
            typeof peek === 'object' &&
            (peek as { __outcome?: unknown }).__outcome === 'redirect' &&
            typeof (peek as { to?: unknown }).to === 'string'
          ) {
            const to = (peek as { to: string }).to;
            if (typeof window !== 'undefined') {
              window.location.assign(to);
            }
            // Cast through `as` because TS can't see this promise never settles.
            return await new Promise<MutateResult<TResult>>(() => {});
          }
        }

        if (contentType.includes('text/event-stream') && response.body) {
          const { readSSE } = await import('./internal/sse-decoder.js');
          let resultValue: TResult | undefined;
          let streamError: Error | null = null;
          for await (const ev of readSSE(response.body)) {
            if (ev.event === 'message') {
              try {
                currentOptions?.onChunk?.(JSON.parse(ev.data) as TChunk);
              } catch {
                // malformed JSON in stream: skip
              }
            } else if (ev.event === 'result') {
              try {
                resultValue = JSON.parse(ev.data) as TResult;
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
            throw streamError;
          }
          if (resultValue !== undefined) {
            setData(resultValue);
            invokeSuccess(resultValue);
            finalResult = resultValue;
          } else {
            // Streaming action closed without emitting a `result` event;
            // resolve with `data: undefined`. `onSuccess` is not called
            // in this branch since there is no result value to deliver
            // (matches the static-action path where onSuccess only fires
            // with a real value).
            finalResult = undefined;
          }
        } else {
          const result = (await response.json()) as TResult;
          setData(result);
          invokeSuccess(result);
          finalResult = result;
        }

        if (currentOptions?.invalidate === 'auto') {
          reloadCtx?.reload();
        } else if (Array.isArray(currentOptions?.invalidate)) {
          let invalidatedActive = false;
          for (const ref of currentOptions.invalidate) {
            ref.invalidate();
            if (activeLoaderId && ref.__id === activeLoaderId) {
              invalidatedActive = true;
            }
          }
          // If the user's invalidate list includes the active page's loader,
          // also re-run that loader so the visible <Loader> picks up fresh
          // data. Other refs (sibling pages) just clear their caches; those
          // pages will refetch on their next mount.
          if (invalidatedActive) {
            reloadCtx?.reload();
          }
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        invokeError(e);
        setPending(false);
        return { ok: false, error: e };
      }
      setPending(false);
      return { ok: true, data: finalResult };
    },
    []
  );

  return { mutate, pending, error, data };
}
