import { readSSE } from './sse-decoder.js';

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

/**
 * POST to /__loaders and consume the response.
 *
 * Static loaders return JSON; the parsed value resolves the returned promise.
 * Streaming loaders return SSE; the first chunk resolves the promise, and
 * subsequent chunks fire callbacks.onChunk. Stream errors after the first
 * chunk fire callbacks.onError. Stream end fires callbacks.onEnd.
 */
export async function fetchLoaderData<T>(
  moduleKey: string,
  loaderName: string,
  location: SerializedLocation,
  signal: AbortSignal,
  callbacks: LoaderFetchCallbacks<T>
): Promise<T> {
  const res = await fetch('/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: moduleKey, loader: loaderName, location }),
    signal,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Loader failed with status ${res.status}`);
  }

  const contentType = res.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    const json = (await res.json()) as unknown;
    // Server-side `GuardRedirect` thrown from a loader (or a guard that runs
    // inside it) comes back as a `{ __redirect }` envelope. Hand off to the
    // browser via `location.assign` and return a promise that never settles:
    // the current document is being replaced, no caller will see a value.
    if (
      json !== null &&
      typeof json === 'object' &&
      '__redirect' in json &&
      typeof (json as { __redirect: unknown }).__redirect === 'string'
    ) {
      if (typeof window !== 'undefined') {
        window.location.assign((json as { __redirect: string }).__redirect);
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

  // SSE: read the first message event synchronously (await first chunk),
  // then kick off an async loop that pushes subsequent chunks to callbacks.
  const iter = readSSE(res.body);
  let firstChunk: T | undefined;

  while (true) {
    const step = await iter.next();
    if (step.done) {
      // Stream closed before any data event: error
      throw new Error('Streaming loader closed before emitting any data');
    }
    const ev = step.value;
    if (ev.event === 'message') {
      try {
        firstChunk = JSON.parse(ev.data) as T;
      } catch {
        throw new Error('Malformed first chunk in streaming loader');
      }
      break;
    }
    if (ev.event === 'error') {
      try {
        const parsed = JSON.parse(ev.data) as {
          message?: string;
          name?: string;
        };
        const err = new Error(parsed.message ?? 'Streamed error');
        if (parsed.name) err.name = parsed.name;
        throw err;
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Malformed')) {
          throw new Error('Malformed error event in streaming loader');
        }
        throw e;
      }
    }
    // Other events (result, etc.): ignore for loaders
  }

  // Continue consuming chunks in the background. Each subsequent message
  // pushes a value via onChunk. Errors fire onError. End fires onEnd.
  (async () => {
    try {
      while (true) {
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
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return firstChunk as T;
}
