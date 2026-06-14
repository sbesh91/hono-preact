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
  const res = await fetch(LOADERS_RPC_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: moduleKey, loader: loaderName, location }),
    signal,
  });

  if (!res.ok) {
    // Try to parse a deny outcome envelope first; it carries `message`
    // rather than `error`. Fall back to the legacy `{ error }` shape.
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
      // The `deny()` constructor defaults `message` for first-party
      // callers, but a hand-rolled envelope from custom server middleware
      // might still arrive without one. Surface a deny-aware fallback
      // instead of the generic "Loader failed" so the user sees a hint
      // that the status came from an explicit deny.
      const msg =
        typeof body.message === 'string'
          ? body.message
          : `Request denied (${res.status})`;
      throw new Error(msg);
    }
    throw new Error(body.error ?? `Loader failed with status ${res.status}. Check the loader's .server.ts for a thrown error, and the server logs for details.`);
  }

  const contentType = res.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    const json = (await res.json()) as unknown;
    // Collision risk note (deferred from middleware review C6): a loader
    // that legitimately returns data shaped `{ __outcome: 'redirect', to:
    // <string> }` would be misinterpreted here and navigate the browser.
    // The probability is low (the magic key is namespaced and unusual) and
    // a wire-version sentinel like `__envelope: 'hono-preact/redirect'` or
    // a `X-Hono-Preact-Outcome: redirect` response header would close the
    // gap. Deferred for v0.2: body-key sniffing is the documented contract
    // for v0.1.
    // Server-side middleware that throws `redirect(...)` comes back as a
    // redirect outcome envelope. Hand off to the browser via
    // `location.assign` and return a promise that never settles: the
    // current document is being replaced, no caller will see a value.
    //
    // Trust boundary: `to` is taken straight from the JSON body and passed
    // to `window.location.assign`. The framework's own handlers emit safe
    // (typically same-origin) values, but a compromised or misconfigured
    // server (or a proxy injecting JSON) could push the client anywhere.
    // We don't validate origin here for v0.1; treat your own server as
    // part of the trusted boundary. A same-origin check is a deferred
    // enhancement (see C4 in the middleware review).
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

  // SSE: read the first message event synchronously (await first chunk),
  // then kick off an async loop that pushes subsequent chunks to callbacks.
  const iter = readSSE(res.body);
  const firstChunk = await readFirstChunk<T>(iter);

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
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return firstChunk;
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
