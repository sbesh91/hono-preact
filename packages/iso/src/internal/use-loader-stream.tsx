import { useContext, useEffect, useId, useRef, useState } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { RouteLocationsContext } from './route-locations.js';
import { runLoader } from './loader-runner.js';
import { serializeLocationForCache } from './cache-key.js';

export type StreamStatus = 'connecting' | 'open' | 'closed' | 'error';

export type UseStreamOptions<T, Acc> = {
  /** Fold each streamed chunk into the accumulated value. */
  reduce: (acc: Acc, chunk: T) => Acc;
  /** Accumulator seed (also the server-render value). */
  initial: Acc;
  /** Optional per-chunk side effect. */
  onChunk?: (chunk: T) => void;
};

export type UseStreamResult<Acc> = {
  data: Acc;
  status: StreamStatus;
  error: Error | null;
};

/**
 * Subscribe to a streaming loader and fold EVERY chunk into accumulated state.
 * Unlike `useData()` (latest value, Suspense), this is client-only and
 * status-driven: it returns `initial`/`'connecting'` during SSR and connects
 * post-hydration. The loader's location is read from `RouteLocationsContext`
 * (a layout's stable location), so inside a layout it connects once and
 * survives intra-scope navigation.
 */
export function useLoaderStream<T, Acc>(
  loaderRef: LoaderRef<T>,
  opts: UseStreamOptions<T, Acc>
): UseStreamResult<Acc> {
  const id = useId();
  const locMap = useContext(RouteLocationsContext);
  const ctxLocation = loaderRef.__moduleKey
    ? locMap?.get(loaderRef.__moduleKey)
    : undefined;

  // Track latest reduce/onChunk/initial without forcing a re-subscribe.
  const reduceRef = useRef(opts.reduce);
  reduceRef.current = opts.reduce;
  const onChunkRef = useRef(opts.onChunk);
  onChunkRef.current = opts.onChunk;
  const initialRef = useRef(opts.initial);

  const [data, setData] = useState<Acc>(opts.initial);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [error, setError] = useState<Error | null>(null);

  // Re-subscribe only when the loader identity or its resolved location changes.
  const locKey = ctxLocation
    ? serializeLocationForCache(ctxLocation, loaderRef.params)
    : '';

  useEffect(() => {
    if (!ctxLocation) {
      setStatus('error');
      setError(
        new Error(
          `loader.useStream for module '${loaderRef.__moduleKey ?? '<unkeyed>'}' has no location: ` +
            `use it inside a layout/route whose server module includes this loader's .server.ts file.`
        )
      );
      return;
    }

    // Fresh subscription: reset accumulated state.
    setData(initialRef.current);
    setStatus('connecting');
    setError(null);

    const controller = new AbortController();
    const apply = (chunk: T) => {
      onChunkRef.current?.(chunk);
      setData((prev) => reduceRef.current(prev, chunk));
      setStatus('open');
    };

    const first = runLoader<T>(loaderRef, ctxLocation, id, controller.signal, {
      onChunk: apply,
      onError: (err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setStatus('error');
      },
      onEnd: () => {
        if (controller.signal.aborted) return;
        setStatus('closed');
      },
    });
    first.then(
      (firstChunk) => {
        if (!controller.signal.aborted) apply(firstChunk);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      }
    );

    return () => controller.abort();
    // ctxLocation is captured via locKey; reduce/onChunk/initial via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderRef.__id, locKey]);

  return { data, status, error };
}
