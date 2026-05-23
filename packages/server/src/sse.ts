import type { Context } from 'hono';
import type { StreamObserver, ServerStreamCtx } from '@hono-preact/iso';
import {
  fanStart,
  fanChunk,
  fanEnd,
  fanError,
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

type SSEFrame = { event?: string; id?: string; data: string };

function sseEncodeTransform(): TransformStream<SSEFrame, Uint8Array> {
  const encoder = new TextEncoder();
  return new TransformStream<SSEFrame, Uint8Array>({
    transform(frame, controller) {
      const lines: string[] = [];
      if (frame.event) lines.push(`event: ${frame.event}`);
      if (frame.id) lines.push(`id: ${frame.id}`);
      lines.push(`data: ${frame.data}`);
      controller.enqueue(encoder.encode(lines.join('\n') + '\n\n'));
    },
  });
}

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
 * is written and the stream closes cleanly.
 *
 * When `observers` is provided, the pump fires the corresponding lifecycle
 * hooks (`onStart` / `onChunk` / `onEnd` / `onError`) so users can attach
 * instrumentation via `defineStreamObserver(...)`.
 *
 * Note: `onAbort` is not called from this function. Cancellation propagates
 * via `ReadableStream.from(gen)` calling the generator's `return()` when the
 * client closes; observers wanting abort notification should use the readable-
 * stream variant or a future hook added to `cancel()`.
 */
export function sseGeneratorResponse(
  _c: Context,
  gen: AsyncGenerator<unknown, unknown, unknown>,
  options: SseGeneratorOptions = {}
): Response {
  const {
    emitResult = false,
    observers,
    observerCtx,
    signal,
    timeoutMs,
  } = options;
  const obs = observers ?? [];

  // The pump generator owns the lifecycle: it adapts the user's generator
  // into a stream of SSEFrames, calls observer hooks, and emits a trailing
  // `result`, `timeout`, or `error` frame as needed.
  async function* framePump(): AsyncGenerator<SSEFrame, void, unknown> {
    let chunks = 0;
    let started = false;
    if (obs.length > 0 && observerCtx) {
      fanStart(obs, observerCtx);
      started = true;
    }
    try {
      while (true) {
        const step = await gen.next();
        if (step.done) {
          if (emitResult && step.value !== undefined) {
            yield { event: 'result', data: JSON.stringify(step.value) };
          }
          if (started && observerCtx) {
            fanEnd(obs, observerCtx, { chunks, result: step.value });
          }
          return;
        }
        yield { data: JSON.stringify(step.value) };
        if (started && observerCtx) {
          fanChunk(obs, observerCtx, step.value, chunks);
        }
        chunks += 1;
      }
    } catch (err) {
      await gen.return(undefined).catch(() => undefined);
      if (started && observerCtx) {
        fanError(obs, observerCtx, err, { chunks });
      }
      if (isTimeoutAbort(signal) && typeof timeoutMs === 'number') {
        yield {
          event: 'timeout',
          data: JSON.stringify({ timeoutMs }),
        };
      } else {
        yield { event: 'error', data: encodeErrorPayload(err) };
      }
    }
  }

  // ReadableStream.from is not yet in the TypeScript DOM lib. The constructor
  // form is equivalent and fully typed.
  const pump = framePump();
  const body = new ReadableStream<SSEFrame>({
    async pull(controller) {
      const { value, done } = await pump.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel() {
      pump.return(undefined).catch(() => undefined);
      gen.return(undefined).catch(() => undefined);
    },
  }).pipeThrough(sseEncodeTransform());

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}

/**
 * Wrap a ReadableStream<T> (with T a JSON-encodable value) as an SSE response.
 * Each enqueued chunk is JSON-encoded and written as a `data:` event.
 *
 * Observer fanout mirrors `sseGeneratorResponse`: `onStart` fires before the
 * first read, `onChunk` per chunk, `onEnd` on normal completion, `onError` on
 * throw.
 *
 * Note: `onAbort` is not called from this function. Cancellation propagates
 * via the `ReadableStream` constructor's `cancel()` callback calling
 * `pump.return()`; observers wanting abort notification should use a future
 * hook added to `cancel()`.
 */
export function sseReadableStreamResponse(
  _c: Context,
  source: ReadableStream<unknown>,
  options: {
    observers?: ReadonlyArray<StreamObserver<unknown, never>>;
    observerCtx?: ServerStreamCtx;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Response {
  const { observers, observerCtx, signal, timeoutMs } = options;
  const obs = observers ?? [];

  async function* framePump(): AsyncGenerator<SSEFrame, void, unknown> {
    const reader = source.getReader();
    let chunks = 0;
    let started = false;
    if (obs.length > 0 && observerCtx) {
      fanStart(obs, observerCtx);
      started = true;
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (started && observerCtx) {
            fanEnd(obs, observerCtx, { chunks, result: undefined });
          }
          return;
        }
        yield { data: JSON.stringify(value) };
        if (started && observerCtx) {
          fanChunk(obs, observerCtx, value, chunks);
        }
        chunks += 1;
      }
    } catch (err) {
      if (started && observerCtx) {
        fanError(obs, observerCtx, err, { chunks });
      }
      if (isTimeoutAbort(signal) && typeof timeoutMs === 'number') {
        yield {
          event: 'timeout',
          data: JSON.stringify({ timeoutMs }),
        };
      } else {
        yield { event: 'error', data: encodeErrorPayload(err) };
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }

  const pump = framePump();
  const body = new ReadableStream<SSEFrame>({
    async pull(controller) {
      const { value, done } = await pump.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel() {
      pump.return(undefined).catch(() => undefined);
    },
  }).pipeThrough(sseEncodeTransform());

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
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
