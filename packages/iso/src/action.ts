import { useContext, useState } from 'preact/hooks';
import { ReloadContext } from './page.js';

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
  invalidate?: 'auto' | false;
  onMutate?: (payload: TPayload) => unknown;
  onError?: (err: Error, snapshot: unknown) => void;
  onSuccess?: (data: TResult) => void;
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

  const mutate = async (payload: TPayload) => {
    setPending(true);
    setError(null);

    let snapshot: unknown;
    if (options?.onMutate) {
      snapshot = options.onMutate(payload);
    }

    try {
      const response = await fetch('/__actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: (stub as unknown as { __module: string }).__module,
          action: (stub as unknown as { __action: string }).__action,
          payload,
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `Action failed with status ${response.status}`);
      }

      const result = (await response.json()) as TResult;
      setData(result);
      options?.onSuccess?.(result);

      if (options?.invalidate === 'auto') {
        reloadCtx?.reload();
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      options?.onError?.(e, snapshot);
    } finally {
      setPending(false);
    }
  };

  return { mutate, pending, error, data };
}
