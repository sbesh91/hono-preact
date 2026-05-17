import { useCallback, useContext, useRef, useState } from 'preact/hooks';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ReloadContext } from './reload-context.js';
import { ActiveLoaderIdContext } from './internal/contexts.js';
import type { LoaderRef } from './define-loader.js';

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
  | ((ctx: ActionCtx, payload: TPayload) => AsyncGenerator<TChunk, TResult, unknown>);

export function defineAction<TPayload, TResult, TChunk = never>(
  fn: ActionFn<TPayload, TResult, TChunk>
): ActionStub<TPayload, TResult, TChunk> {
  // Runtime no-op: returns fn as-is. actionsHandler casts it back to a function.
  // The ActionStub type is enforced only by TypeScript and the Vite plugin.
  return fn as unknown as ActionStub<TPayload, TResult, TChunk>;
}

export type UseActionOptions<TPayload, TResult, TChunk = never, TSnapshot = unknown> = {
  invalidate?: 'auto' | false | ReadonlyArray<LoaderRef<unknown>>;
  onMutate?: (payload: TPayload) => TSnapshot;
  onChunk?: (chunk: TChunk) => void;
  onError?: (err: Error, snapshot: TSnapshot) => void;
  onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
};

/**
 * The value `mutate` resolves to. A discriminated union so callers can
 * chain on success without awaiting then probing the hook's `data`/`error`
 * state, and without leaking unhandled rejections in fire-and-forget callers.
 *
 * - Success: `{ ok: true, data }`. For streaming actions that emit no
 *   `result` SSE event, `data` is `undefined`; declare `TResult = void` (or
 *   include `undefined` in its union) if your action doesn't emit a result.
 * - Failure: `{ ok: false, error }`. The same `Error` instance is also
 *   written to the hook's `error` state and passed to `onError`.
 *
 * Returning a union (rather than throwing) keeps `mutate(...)` ergonomic
 * for non-awaiting call sites — the existing `error` state field is the
 * idiomatic way to render an error UI — while still letting awaiting
 * callers do `if (result.ok) navigate(...)`.
 */
export type MutateResult<TResult> =
  | { ok: true; data: TResult }
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
  return Object.values(payload as Record<string, unknown>).some((v) => v instanceof File);
}

export function useAction<TPayload, TResult, TChunk = never, TSnapshot = unknown>(
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

  const mutate = useCallback(async (payload: TPayload): Promise<MutateResult<TResult>> => {
    setPending(true);
    setError(null);

    const currentStub = stubRef.current;
    const currentOptions = optionsRef.current;
    let snapshot: unknown;
    if (currentOptions?.onMutate) {
      snapshot = currentOptions.onMutate(payload);
    }

    let finalResult: TResult | undefined;
    try {
      const stub = currentStub as unknown as { __module: string; __action: string };
      let response: Response;
      if (hasFileValues(payload)) {
        const fd = new FormData();
        fd.append('__module', stub.__module);
        fd.append('__action', stub.__action);
        for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
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
            module: stub.__module,
            action: stub.__action,
            payload,
          }),
        });
      }

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `Action failed with status ${response.status}`);
      }

      const contentType = response.headers.get('Content-Type') ?? '';
      // Server-side `GuardRedirect` thrown from an action (or its guards) comes
      // back as `{ __redirect }`. Hand off to the browser; the rest of this
      // promise will never settle, but the page is navigating away anyway.
      if (!contentType.includes('text/event-stream')) {
        const peek = (await response.clone().json().catch(() => undefined)) as unknown;
        if (
          peek !== null &&
          typeof peek === 'object' &&
          peek !== undefined &&
          '__redirect' in peek &&
          typeof (peek as { __redirect: unknown }).__redirect === 'string'
        ) {
          if (typeof window !== 'undefined') {
            window.location.assign((peek as { __redirect: string }).__redirect);
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
          } else if (ev.event === 'error') {
            try {
              const parsed = JSON.parse(ev.data) as { message?: string; name?: string };
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
          currentOptions?.onSuccess?.(resultValue, snapshot as TSnapshot);
          finalResult = resultValue;
        } else {
          currentOptions?.onSuccess?.(undefined as unknown as TResult, snapshot as TSnapshot);
          // Streaming actions with no `result` event resolve with undefined.
          // Consumers should type `TResult = void` (or include `undefined`)
          // when their action doesn't emit a result.
          finalResult = undefined as unknown as TResult;
        }
      } else {
        const result = (await response.json()) as TResult;
        setData(result);
        currentOptions?.onSuccess?.(result, snapshot as TSnapshot);
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
      currentOptions?.onError?.(e, snapshot as TSnapshot);
      setPending(false);
      return { ok: false, error: e };
    }
    setPending(false);
    return { ok: true, data: finalResult as TResult };
  }, []);

  return { mutate, pending, error, data };
}

export type ActionGuardContext = {
  c: Context;
  module: string;
  action: string;
  payload: unknown;
};

export type ActionGuardFn = (
  ctx: ActionGuardContext,
  next: () => Promise<void>
) => Promise<void>;

export class ActionGuardError extends Error {
  constructor(
    message: string,
    public readonly status: ContentfulStatusCode = 403,
  ) {
    super(message);
    this.name = 'ActionGuardError';
  }
}

export const defineActionGuard = (fn: ActionGuardFn): ActionGuardFn => fn;
