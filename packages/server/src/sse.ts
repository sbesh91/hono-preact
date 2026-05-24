import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { StreamObserver, ServerStreamCtx } from '@hono-preact/iso';
import {
  fanStart,
  fanChunk,
  fanEnd,
  fanError,
  fanAbort,
} from '@hono-preact/iso/internal';

export type SseGeneratorOptions = {
  /** When true, the generator's return value is emitted as `event: result`. */
  emitResult?: boolean;
  /**
   * Stream observers harvested from the loader/action's `use` array (the
   * non-middleware partition). The SSE pump fires `onStart` before the
   * first chunk, `onChunk` per yielded value, `onEnd` on clean completion,
   * `onError` on throw, and `onAbort` when the response stream is aborted
   * (typically because the client disconnected). Hooks are isolated: a
   * throwing observer never corrupts the stream.
   */
  observers?: ReadonlyArray<StreamObserver<unknown, never>>;
  /** Server-stream ctx threaded to each observer hook. */
  observerCtx?: ServerStreamCtx;
  /**
   * The handler's timeout signal (from `AbortSignal.timeout(timeoutMs)`),
   * inspected in the catch path to distinguish a deadline-driven abort
   * from a generic throw. When this signal has aborted with a
   * `TimeoutError` DOMException, the pump emits `event: timeout` with
   * `{ timeoutMs }` instead of the generic `event: error` frame.
   */
  signal?: AbortSignal;
  /** Used only with `signal`; the timeout value reported in the frame. */
  timeoutMs?: number;
};

function isTimeoutAbort(signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted &&
    signal.reason instanceof DOMException &&
    signal.reason.name === 'TimeoutError'
  );
}

function encodeErrorPayload(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : 'Error';
  return JSON.stringify({ message, name });
}

/**
 * Wrap an async generator as an SSE response.
 *
 * Each yield is JSON-encoded and written as a `data:` event.
 * If `emitResult` is true and the generator's return value is defined,
 * it is written as `event: result\ndata: <json>` before the stream closes.
 * If the generator throws, an `event: error\ndata: {"message","name"}` frame
 * is written and the stream closes cleanly (Hono's default error handler is
 * never invoked because we catch inside the callback).
 *
 * When `observers` is provided, the pump fires the corresponding lifecycle
 * hooks (`onStart` / `onChunk` / `onEnd` / `onError` / `onAbort`) so
 * users can attach instrumentation via `defineStreamObserver(...)`.
 */
export function sseGeneratorResponse(
  c: Context,
  gen: AsyncGenerator<unknown, unknown, unknown>,
  options: SseGeneratorOptions = {}
): Response {
  const {
    emitResult = false,
    observers,
    observerCtx,
    signal: optSignal,
    timeoutMs: optTimeoutMs,
  } = options;
  const obs = observers ?? [];
  return streamSSE(c, async (stream) => {
    let chunks = 0;
    let started = false;
    if (obs.length > 0 && observerCtx) {
      fanStart(obs, observerCtx);
      started = true;
    }
    try {
      while (!stream.aborted) {
        const step = await gen.next();
        if (step.done) {
          if (emitResult && step.value !== undefined) {
            await stream.writeSSE({
              event: 'result',
              data: JSON.stringify(step.value),
            });
          }
          if (started && observerCtx) {
            fanEnd(obs, observerCtx, { chunks, result: step.value });
          }
          return;
        }
        await stream.writeSSE({ data: JSON.stringify(step.value) });
        if (started && observerCtx) {
          fanChunk(obs, observerCtx, step.value, chunks);
        }
        chunks += 1;
      }
      // Loop exited because the response stream was aborted (typically a
      // client disconnect). Release the generator and notify observers.
      await gen.return(undefined).catch(() => {
        /* swallow */
      });
      if (started && observerCtx) {
        fanAbort(obs, observerCtx, { chunks });
      }
    } catch (err) {
      await gen.return(undefined).catch(() => {
        /* swallow */
      });
      if (started && observerCtx) {
        fanError(obs, observerCtx, err, { chunks });
      }
      if (isTimeoutAbort(optSignal) && typeof optTimeoutMs === 'number') {
        await stream.writeSSE({
          event: 'timeout',
          data: JSON.stringify({ timeoutMs: optTimeoutMs }),
        });
      } else {
        await stream.writeSSE({
          event: 'error',
          data: encodeErrorPayload(err),
        });
      }
    }
  });
}

/**
 * Wrap a ReadableStream<T> (with T a JSON-encodable value) as an SSE response.
 * Each enqueued chunk is JSON-encoded and written as a `data:` event.
 *
 * Observer fanout mirrors `sseGeneratorResponse`: `onStart` fires before the
 * first read, `onChunk` per chunk, `onEnd` on normal completion, `onError` on
 * throw, `onAbort` when the response stream is aborted.
 */
export function sseReadableStreamResponse(
  c: Context,
  source: ReadableStream<unknown>,
  options: {
    observers?: ReadonlyArray<StreamObserver<unknown, never>>;
    observerCtx?: ServerStreamCtx;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Response {
  const {
    observers,
    observerCtx,
    signal: optSignal,
    timeoutMs: optTimeoutMs,
  } = options;
  const obs = observers ?? [];
  return streamSSE(c, async (stream) => {
    const reader = source.getReader();
    let chunks = 0;
    let started = false;
    if (obs.length > 0 && observerCtx) {
      fanStart(obs, observerCtx);
      started = true;
    }
    try {
      while (!stream.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          if (started && observerCtx) {
            fanEnd(obs, observerCtx, { chunks, result: undefined });
          }
          return;
        }
        await stream.writeSSE({ data: JSON.stringify(value) });
        if (started && observerCtx) {
          fanChunk(obs, observerCtx, value, chunks);
        }
        chunks += 1;
      }
      if (started && observerCtx) {
        fanAbort(obs, observerCtx, { chunks });
      }
    } catch (err) {
      if (started && observerCtx) {
        fanError(obs, observerCtx, err, { chunks });
      }
      if (isTimeoutAbort(optSignal) && typeof optTimeoutMs === 'number') {
        await stream.writeSSE({
          event: 'timeout',
          data: JSON.stringify({ timeoutMs: optTimeoutMs }),
        });
      } else {
        await stream.writeSSE({
          event: 'error',
          data: encodeErrorPayload(err),
        });
      }
    } finally {
      reader.cancel().catch(() => {
        /* swallow */
      });
    }
  });
}

export function isAsyncGenerator(
  value: unknown
): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] === 'function' &&
    typeof (value as { next?: unknown }).next === 'function'
  );
}
