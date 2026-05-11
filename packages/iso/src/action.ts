import { useCallback, useContext, useRef, useState } from 'preact/hooks';
import { ReloadContext } from './reload-context.js';
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
  c: unknown;
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

export type UseActionResult<TPayload, TResult> = {
  mutate: (payload: TPayload) => Promise<void>;
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

  const stubRef = useRef(stub);
  stubRef.current = stub;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mutate = useCallback(async (payload: TPayload) => {
    setPending(true);
    setError(null);

    const currentStub = stubRef.current;
    const currentOptions = optionsRef.current;
    let snapshot: unknown;
    if (currentOptions?.onMutate) {
      snapshot = currentOptions.onMutate(payload);
    }

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
        } else {
          currentOptions?.onSuccess?.(undefined as unknown as TResult, snapshot as TSnapshot);
        }
      } else {
        const result = (await response.json()) as TResult;
        setData(result);
        currentOptions?.onSuccess?.(result, snapshot as TSnapshot);
      }

      if (currentOptions?.invalidate === 'auto') {
        reloadCtx?.reload();
      } else if (Array.isArray(currentOptions?.invalidate)) {
        let invalidatedActive = false;
        for (const ref of currentOptions.invalidate) {
          ref.invalidate();
          if (reloadCtx?.loaderId && ref.__id === reloadCtx.loaderId) {
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
    } finally {
      setPending(false);
    }
  }, []);

  return { mutate, pending, error, data };
}

export type ActionGuardContext = {
  c: unknown;
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
    public readonly status: number = 403
  ) {
    super(message);
    this.name = 'ActionGuardError';
  }
}

export const defineActionGuard = (fn: ActionGuardFn): ActionGuardFn => fn;
