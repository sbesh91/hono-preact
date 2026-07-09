import type { Context } from 'hono';
import type { StreamObserver, ServerStreamCtx } from '@hono-preact/iso';
import {
  fanStart,
  fanChunk,
  fanEnd,
  fanError,
  fanAbort,
} from '@hono-preact/iso/internal';

/**
 * Options shared by both SSE response helpers. Encodes the lifecycle the SSE
 * pump runs through:
 *
 * - Observer fanout: `onStart` fires before the first chunk, `onChunk` per
 *   value yielded by the source, `onEnd` on normal completion, `onError` on
 *   a thrown error, `onAbort` when the consumer cancels the response stream
 *   before the source finishes.
 * - Timeout discrimination: when `signal.aborted` and `signal.reason` is a
 *   `TimeoutError` `DOMException`, the catch path emits `event: timeout`
 *   with `{ timeoutMs }` instead of the generic `event: error` frame.
 */
export type SseResponseOptions = {
  /**
   * When true, the generator's return value (if defined) is emitted as
   * `event: result` before the stream closes. Only meaningful for
   * generator-sourced responses; ignored for `ReadableStream` sources.
   */
  emitResult?: boolean;
  /**
   * Stream observers harvested from the loader/action's `use` array (the
   * non-middleware partition). Hooks are isolated: a throwing observer
   * never corrupts the stream.
   */
  observers?: ReadonlyArray<StreamObserver<unknown, never>>;
  /** Server-stream ctx threaded to each observer hook. */
  observerCtx?: ServerStreamCtx;
  /**
   * The handler's timeout signal (from `AbortSignal.timeout(timeoutMs)`),
   * inspected in the catch path to distinguish a deadline-driven abort
   * from a generic throw.
   */
  signal?: AbortSignal;
  /** Used only with `signal`; the timeout value reported in the frame. */
  timeoutMs?: number;
  /**
   * When true, a thrown stream error's real `message` and `name` ride the
   * `event: error` frame. When false (default), the frame is masked as
   * `{ message: 'Stream failed', name: 'Error' }`: mid-stream errors reach
   * the client verbatim on the wire, so production must not leak internal
   * detail (mirroring the JSON paths' 'Loader failed' / 'Action failed'
   * masking). Timeout frames are unaffected; they carry only `timeoutMs`.
   */
  dev?: boolean;
};

/** Alias retained for source compatibility with earlier code. */
export type SseGeneratorOptions = SseResponseOptions;

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

/**
 * Mask a thrown error's detail unless `dev` is true. Shared by every
 * mid-stream error surface that puts an error's `message`/`name` directly on
 * the wire: the SSE `event: error` frame here and the SSR streaming pump's
 * per-loader error script (`stream-pump.ts`). Production masks to `{ message:
 * 'Stream failed', name: 'Error' }` (mirroring the JSON paths' 'Loader
 * failed' / 'Action failed' masking); dev passes the real message and name
 * through. Callers that also run stream observers (fanError) still receive
 * the real error for the observability side channel regardless of `dev`.
 */
export function maskStreamError(
  err: unknown,
  dev: boolean
): { message: string; name: string } {
  if (!dev) {
    return { message: 'Stream failed', name: 'Error' };
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    name: err instanceof Error ? err.name : 'Error',
  };
}

function encodeErrorPayload(err: unknown, dev: boolean): string {
  return JSON.stringify(maskStreamError(err, dev));
}

/**
 * Adapt a `ReadableStream<T>` as an async generator (with no return value).
 * The reader is released in `finally`, which fires either when the consumer
 * stops iterating or when the source is exhausted.
 */
async function* iterReadable<T>(
  stream: ReadableStream<T>
): AsyncGenerator<T, void, unknown> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/**
 * The shared pump implementation. Iterates `source` (a generator that may
 * return a final value), encodes each yielded value as a JSON `data:` frame,
 * runs the observer lifecycle, and translates errors into `event: error` or
 * `event: timeout` frames.
 *
 * Observer state (`chunks`, `started`, `finished`) lives in the outer
 * function scope so the outer ReadableStream's `cancel()` callback can fire
 * `onAbort` when the consumer cancels mid-stream.
 */
function buildSseResponse(
  source: AsyncGenerator<unknown, unknown, unknown>,
  options: SseResponseOptions
): Response {
  const {
    emitResult = false,
    observers,
    observerCtx,
    signal,
    timeoutMs,
    dev = false,
  } = options;
  const obs = observers ?? [];
  let chunks = 0;
  let started = false;
  let finished = false;

  async function* framePump(): AsyncGenerator<SSEFrame, void, unknown> {
    if (obs.length > 0 && observerCtx) {
      fanStart(obs, observerCtx);
      started = true;
    }
    try {
      while (true) {
        const step = await source.next();
        if (step.done) {
          if (emitResult && step.value !== undefined) {
            yield { event: 'result', data: JSON.stringify(step.value) };
          }
          if (started && observerCtx) {
            fanEnd(obs, observerCtx, { chunks, result: step.value });
          }
          finished = true;
          return;
        }
        yield { data: JSON.stringify(step.value) };
        if (started && observerCtx) {
          fanChunk(obs, observerCtx, step.value, chunks);
        }
        chunks += 1;
      }
    } catch (err) {
      await source.return(undefined).catch(() => undefined);
      if (started && observerCtx) {
        fanError(obs, observerCtx, err, { chunks });
      }
      if (isTimeoutAbort(signal) && typeof timeoutMs === 'number') {
        yield { event: 'timeout', data: JSON.stringify({ timeoutMs }) };
      } else {
        yield { event: 'error', data: encodeErrorPayload(err, dev) };
      }
      finished = true;
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
      // Consumer cancelled before the pump completed. Notify observers via
      // `onAbort` exactly when we've genuinely been aborted mid-stream
      // (i.e. the source started but didn't finish naturally).
      if (!finished && started && observerCtx) {
        fanAbort(obs, observerCtx, { chunks });
      }
      pump.return(undefined).catch(() => undefined);
      source.return(undefined).catch(() => undefined);
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
 * Wrap an async generator as an SSE response.
 *
 * Each yield is JSON-encoded and written as a `data:` event. If `emitResult`
 * is true and the generator's return value is defined, it is written as
 * `event: result\ndata: <json>` before the stream closes. If the generator
 * throws, an `event: error` or `event: timeout` frame is written and the
 * stream closes cleanly. Observer lifecycle hooks (`onStart` / `onChunk` /
 * `onEnd` / `onError` / `onAbort`) fire from inside the pump.
 */
export function sseGeneratorResponse(
  _c: Context,
  gen: AsyncGenerator<unknown, unknown, unknown>,
  options: SseResponseOptions = {}
): Response {
  return buildSseResponse(gen, options);
}

/**
 * Wrap a `ReadableStream<T>` (with `T` a JSON-encodable value) as an SSE
 * response. Each enqueued chunk is JSON-encoded and written as a `data:`
 * event. Observer lifecycle hooks fire identically to `sseGeneratorResponse`;
 * `emitResult` is not meaningful here (streams have no return value) and is
 * ignored.
 */
export function sseReadableStreamResponse(
  _c: Context,
  source: ReadableStream<unknown>,
  options: SseResponseOptions = {}
): Response {
  return buildSseResponse(iterReadable(source), {
    ...options,
    emitResult: false,
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
