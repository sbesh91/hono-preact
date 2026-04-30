import { useCallback, useContext, useRef, useState } from 'preact/hooks';
import { ReloadContext } from './reload-context.js';
import { cacheRegistry } from './cache-registry.js';

export type ActionStub<TPayload, TResult> = {
  readonly __module: string;
  readonly __action: string;
  readonly __phantom?: readonly [TPayload, TResult];
};

export function defineAction<TPayload, TResult>(
  fn: (ctx: unknown, payload: TPayload) => Promise<TResult>
): ActionStub<TPayload, TResult> {
  // Runtime no-op: returns fn as-is. actionsHandler casts it back to a function.
  // The ActionStub type is enforced only by TypeScript and the Vite plugin.
  return fn as unknown as ActionStub<TPayload, TResult>;
}

export type UseActionOptions<TPayload, TResult, TSnapshot = unknown> = {
  invalidate?: 'auto' | false | string[];
  onMutate?: (payload: TPayload) => TSnapshot;
  onError?: (err: Error, snapshot: TSnapshot) => void;
  onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
  onChunk?: (chunk: string) => void;
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

export function useAction<TPayload, TResult, TSnapshot = unknown>(
  stub: ActionStub<TPayload, TResult>,
  options?: UseActionOptions<TPayload, TResult, TSnapshot>
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
      if (contentType.includes('text/event-stream')) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            currentOptions?.onChunk?.(chunk);
          }
          const tail = decoder.decode();
          if (tail) currentOptions?.onChunk?.(tail);
        } finally {
          reader.releaseLock();
        }
        currentOptions?.onSuccess?.(undefined as unknown as TResult, snapshot as TSnapshot);
      } else {
        const result = (await response.json()) as TResult;
        setData(result);
        currentOptions?.onSuccess?.(result, snapshot as TSnapshot);
      }

      if (currentOptions?.invalidate === 'auto') {
        reloadCtx?.reload();
      } else if (Array.isArray(currentOptions?.invalidate)) {
        for (const name of currentOptions.invalidate) {
          cacheRegistry.invalidate(name);
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
