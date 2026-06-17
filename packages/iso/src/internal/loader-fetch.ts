import { readSSE } from './sse-decoder.js';
import { TimeoutError } from '../action.js';
import { LOADERS_RPC_PATH } from './contract.js';

export type LoaderFetchCallbacks<T> = {
  onChunk: (value: T) => void;
  onError: (err: Error) => void;
  onEnd: () => void;
};

type SerializedLocation = {
  path: string;
  pathParams: Record<string, string>;
  searchParams: Record<string, string>;
};

export type LoaderFetchHandle<T> = {
  /**
   * Resolves with the first (or only) loader value. Rejects on an error or
   * timeout that occurs before the first chunk. For a redirect outcome the
   * promise never settles (the page is navigating away).
   */
  first: Promise<T>;
  /**
   * Attach callbacks for a streaming loader: onChunk fires for each chunk
   * after the first, onError for a mid-stream error/timeout, onEnd at stream
   * end. No-op for non-streaming (JSON) responses. Returns an unsubscribe that
   * stops the background pump. Call at most once.
   */
  subscribe(callbacks: LoaderFetchCallbacks<T>): () => void;
};

/**
 * POST to /__loaders and consume the response.
 *
 * Static loaders return JSON; `handle.first` resolves with the parsed value.
 * Streaming loaders return SSE; `handle.first` resolves with the first chunk
 * and `handle.subscribe(callbacks)` drives the rest (onChunk per later chunk,
 * onError mid-stream, onEnd at end). The pump starts only after `first`
 * settles, so subscribing synchronously after the call loses no chunks.
 */
export function fetchLoaderData<T>(
  moduleKey: string,
  loaderName: string,
  location: SerializedLocation,
  signal: AbortSignal
): LoaderFetchHandle<T> {
  // Populated only when the response is SSE and its first chunk has been read.
  // `subscribe` pumps off this iterator; null means a non-streaming response
  // (nothing to pump).
  let streamIter: AsyncGenerator<{ event: string; data: string }> | null = null;

  const first = (async (): Promise<T> => {
    const res = await fetch(LOADERS_RPC_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: moduleKey, loader: loaderName, location }),
      signal,
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        __outcome?: string;
        message?: string;
        timeoutMs?: number;
      };
      if (body.__outcome === 'timeout' && typeof body.timeoutMs === 'number') {
        throw new TimeoutError(body.timeoutMs);
      }
      if (body.__outcome === 'deny') {
        const msg =
          typeof body.message === 'string'
            ? body.message
            : `Request denied (${res.status})`;
        throw new Error(msg);
      }
      throw new Error(
        body.error ??
          `Loader failed with status ${res.status}. Check the loader's .server.ts for a thrown error, and the server logs for details.`
      );
    }

    const contentType = res.headers.get('Content-Type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      const json = (await res.json()) as unknown;
      // A loader that legitimately returns `{ __outcome: 'redirect', to }` is
      // misinterpreted here (documented v0.1 contract; see C6/C4 in the
      // middleware review). `to` is taken from the body and passed to
      // location.assign; treat your own server as trusted.
      if (
        json !== null &&
        typeof json === 'object' &&
        (json as { __outcome?: unknown }).__outcome === 'redirect' &&
        typeof (json as { to?: unknown }).to === 'string'
      ) {
        const to = (json as { to: string }).to;
        if (typeof window !== 'undefined') {
          window.location.assign(to);
        }
        return new Promise<T>(() => {
          /* never resolves; page is navigating */
        });
      }
      return json as T;
    }

    if (!res.body) {
      throw new Error('Streaming loader response has no body');
    }

    // SSE: read the first message event (await first chunk). Hand the iterator
    // to `subscribe` so later chunks pump on demand.
    const iter = readSSE(res.body);
    const firstChunk = await readFirstChunk<T>(iter);
    streamIter = iter;
    return firstChunk;
  })();

  function subscribe(callbacks: LoaderFetchCallbacks<T>): () => void {
    let stopped = false;
    // Start the pump only after `first` settles: a non-streaming response or a
    // pre-first-chunk rejection leaves `streamIter` null (nothing to pump).
    first.then(
      () => {
        if (stopped || streamIter === null) return;
        const iter = streamIter;
        void (async () => {
          try {
            while (true) {
              if (stopped) return;
              const step = await iter.next();
              if (step.done) {
                callbacks.onEnd();
                return;
              }
              const ev = step.value;
              if (ev.event === 'message') {
                try {
                  callbacks.onChunk(JSON.parse(ev.data) as T);
                } catch {
                  // malformed mid-stream chunk: skip
                }
              } else if (ev.event === 'timeout') {
                try {
                  const parsed = JSON.parse(ev.data) as { timeoutMs?: number };
                  callbacks.onError(new TimeoutError(parsed.timeoutMs ?? 0));
                } catch {
                  callbacks.onError(
                    new Error('Malformed timeout event in streaming loader')
                  );
                }
                return;
              } else if (ev.event === 'error') {
                try {
                  const parsed = JSON.parse(ev.data) as {
                    message?: string;
                    name?: string;
                  };
                  const err = new Error(parsed.message ?? 'Streamed error');
                  if (parsed.name) err.name = parsed.name;
                  callbacks.onError(err);
                } catch {
                  callbacks.onError(new Error('Streamed error'));
                }
                return;
              }
              // Ignore other event types
            }
          } catch (err) {
            if (signal.aborted) return;
            callbacks.onError(
              err instanceof Error ? err : new Error(String(err))
            );
          }
        })();
      },
      () => {
        /* first rejected before any chunk: no stream to pump */
      }
    );
    return () => {
      stopped = true;
    };
  }

  return { first, subscribe };
}

/**
 * Drain the SSE stream until the first `message` event and parse it as `T`.
 * `timeout` / `error` events before the first message reject with the
 * appropriate error. Other event types are ignored.
 */
async function readFirstChunk<T>(
  iter: AsyncGenerator<{ event: string; data: string }>
): Promise<T> {
  while (true) {
    const step = await iter.next();
    if (step.done) {
      throw new Error('Streaming loader closed before emitting any data');
    }
    const ev = step.value;
    if (ev.event === 'message') {
      try {
        return JSON.parse(ev.data) as T;
      } catch {
        throw new Error('Malformed first chunk in streaming loader');
      }
    }
    if (ev.event === 'timeout') {
      let timeoutMs = 0;
      try {
        const parsed = JSON.parse(ev.data) as { timeoutMs?: number };
        timeoutMs = parsed.timeoutMs ?? 0;
      } catch (e) {
        throw new Error(
          `Malformed timeout event in streaming loader: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
      throw new TimeoutError(timeoutMs);
    }
    if (ev.event === 'error') {
      let message = 'Streamed error';
      let name: string | undefined;
      try {
        const parsed = JSON.parse(ev.data) as {
          message?: string;
          name?: string;
        };
        message = parsed.message ?? message;
        name = parsed.name;
      } catch {
        throw new Error('Malformed error event in streaming loader');
      }
      const err = new Error(message);
      if (name) err.name = name;
      throw err;
    }
    // Other events (result, etc.): ignore for loaders
  }
}
