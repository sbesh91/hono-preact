import { useCallback, useContext, useRef, useState } from 'preact/hooks';
import { ReloadContext } from './page.js';
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

export type UseActionOptions<TPayload, TResult> = {
  invalidate?: 'auto' | false | string[];
  onMutate?: (payload: TPayload) => unknown;
  onError?: (err: Error, snapshot: unknown) => void;
  onSuccess?: (data: TResult) => void;
  onChunk?: (chunk: string) => void;
};

export type UseActionResult<TPayload, TResult> = {
  mutate: (payload: TPayload) => Promise<void>;
  pending: boolean;
  error: Error | null;
  data: TResult | null;
};

export function useAction<TPayload, TResult>(
  stub: ActionStub<TPayload, TResult>,
  options?: UseActionOptions<TPayload, TResult>
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
      const response = await fetch('/__actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: (currentStub as unknown as { __module: string }).__module,
          action: (currentStub as unknown as { __action: string }).__action,
          payload,
        }),
      });

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
        } finally {
          reader.releaseLock();
        }
        currentOptions?.onSuccess?.(undefined as unknown as TResult);
      } else {
        const result = (await response.json()) as TResult;
        setData(result);
        currentOptions?.onSuccess?.(result);
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
      currentOptions?.onError?.(e, snapshot);
    } finally {
      setPending(false);
    }
  }, []);

  return { mutate, pending, error, data };
}
