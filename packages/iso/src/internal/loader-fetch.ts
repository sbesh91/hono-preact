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

type SSEMessage = { event: string; data: string };

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
  let streamIter: AsyncGenerator<SSEMessage> | null = null;

  const first = (async (): Promise<T> => {
    const res = await fetch(LOADERS_RPC_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: moduleKey, loader: loaderName, location }),
      signal,
    });

    if (!res.ok) throw await loaderHttpError(res);
    if (!isEventStream(res)) return readJsonResult<T>(res);
    if (!res.body) throw new Error('Streaming loader response has no body');

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
        void pumpStream<T>(streamIter, () => stopped, signal, callbacks);
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

function isEventStream(res: Response): boolean {
  return (res.headers.get('Content-Type') ?? '').includes('text/event-stream');
}

/**
 * Build the error to throw for a non-ok loader response. Prefers the structured
 * outcome envelope (`timeout` / `deny`), then the legacy `{ error }` shape, then
 * a generic status message with remediation.
 */
async function loaderHttpError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    __outcome?: string;
    message?: string;
    timeoutMs?: number;
  };
  if (body.__outcome === 'timeout' && typeof body.timeoutMs === 'number') {
    return new TimeoutError(body.timeoutMs);
  }
  if (body.__outcome === 'deny') {
    // `deny()` defaults `message` for first-party callers, but a hand-rolled
    // envelope from custom server middleware might still arrive without one.
    return new Error(
      typeof body.message === 'string'
        ? body.message
        : `Request denied (${res.status})`
    );
  }
  return new Error(
    body.error ??
      `Loader failed with status ${res.status}. Check the loader's .server.ts for a thrown error, and the server logs for details.`
  );
}

function isRedirectOutcome(json: unknown): json is { to: string } {
  return (
    json !== null &&
    typeof json === 'object' &&
    (json as { __outcome?: unknown }).__outcome === 'redirect' &&
    typeof (json as { to?: unknown }).to === 'string'
  );
}

/**
 * Parse a non-streaming (JSON) loader response. A loader that legitimately
 * returns `{ __outcome: 'redirect', to }` is misinterpreted as a redirect
 * (documented v0.1 contract; see C6/C4 in the middleware review): we hand off
 * to the browser and return a never-settling promise because the current
 * document is being replaced. Trust boundary: `to` comes straight from the body
 * and is passed to `location.assign`; treat your own server as trusted.
 */
async function readJsonResult<T>(res: Response): Promise<T> {
  const json = (await res.json()) as unknown;
  if (isRedirectOutcome(json)) {
    if (typeof window !== 'undefined') {
      window.location.assign(json.to);
    }
    return new Promise<T>(() => {
      /* never resolves; page is navigating */
    });
  }
  return json as T;
}

type LoaderStreamEvent<T> =
  | { kind: 'chunk'; value: T }
  | { kind: 'timeout'; error: TimeoutError }
  | { kind: 'error'; error: Error }
  | { kind: 'malformed'; which: 'chunk' | 'timeout' | 'error'; cause: unknown }
  | { kind: 'ignore' };

/**
 * Classify one SSE event from the loader RPC stream. Single source of truth for
 * the wire protocol (message = chunk, timeout = TimeoutError, error = named
 * Error) and the JSON parsing. Callers decide disposition (resolve/throw on the
 * first chunk vs. fire callbacks while pumping) and how to surface a malformed
 * event.
 */
function classifyLoaderEvent<T>(ev: SSEMessage): LoaderStreamEvent<T> {
  if (ev.event === 'message') {
    try {
      return { kind: 'chunk', value: JSON.parse(ev.data) as T };
    } catch (cause) {
      return { kind: 'malformed', which: 'chunk', cause };
    }
  }
  if (ev.event === 'timeout') {
    try {
      const parsed = JSON.parse(ev.data) as { timeoutMs?: number };
      return {
        kind: 'timeout',
        error: new TimeoutError(parsed.timeoutMs ?? 0),
      };
    } catch (cause) {
      return { kind: 'malformed', which: 'timeout', cause };
    }
  }
  if (ev.event === 'error') {
    try {
      const parsed = JSON.parse(ev.data) as { message?: string; name?: string };
      const error = new Error(parsed.message ?? 'Streamed error');
      if (parsed.name) error.name = parsed.name;
      return { kind: 'error', error };
    } catch (cause) {
      return { kind: 'malformed', which: 'error', cause };
    }
  }
  return { kind: 'ignore' };
}

/**
 * Drain the SSE stream until the first `message` event and parse it as `T`.
 * `timeout` / `error` events before the first message reject with the
 * appropriate error. Other event types are ignored.
 */
async function readFirstChunk<T>(iter: AsyncGenerator<SSEMessage>): Promise<T> {
  while (true) {
    const step = await iter.next();
    if (step.done) {
      throw new Error('Streaming loader closed before emitting any data');
    }
    const event = classifyLoaderEvent<T>(step.value);
    switch (event.kind) {
      case 'chunk':
        return event.value;
      case 'timeout':
      case 'error':
        throw event.error;
      case 'malformed':
        if (event.which === 'chunk') {
          throw new Error('Malformed first chunk in streaming loader');
        }
        if (event.which === 'timeout') {
          throw new Error(
            `Malformed timeout event in streaming loader: ${
              event.cause instanceof Error
                ? event.cause.message
                : String(event.cause)
            }`
          );
        }
        throw new Error('Malformed error event in streaming loader');
      case 'ignore':
        break;
    }
  }
}

/**
 * Pump SSE events after the first chunk to the subscriber's callbacks: onChunk
 * per later message, onError on a mid-stream timeout/error, onEnd at stream end.
 * Stops early when `isStopped()` flips (unsubscribe) or the request aborts.
 */
async function pumpStream<T>(
  iter: AsyncGenerator<SSEMessage>,
  isStopped: () => boolean,
  signal: AbortSignal,
  callbacks: LoaderFetchCallbacks<T>
): Promise<void> {
  try {
    while (true) {
      if (isStopped()) return;
      const step = await iter.next();
      if (step.done) {
        callbacks.onEnd();
        return;
      }
      const event = classifyLoaderEvent<T>(step.value);
      switch (event.kind) {
        case 'chunk':
          callbacks.onChunk(event.value);
          break;
        case 'timeout':
        case 'error':
          callbacks.onError(event.error);
          return;
        case 'malformed':
          // A malformed mid-stream chunk is skipped; a malformed terminal
          // timeout/error event still ends the stream with a generic error.
          if (event.which === 'chunk') break;
          callbacks.onError(
            event.which === 'timeout'
              ? new Error('Malformed timeout event in streaming loader')
              : new Error('Streamed error')
          );
          return;
        case 'ignore':
          break;
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
