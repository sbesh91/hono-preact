import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

export type SseGeneratorOptions = {
  /** When true, the generator's return value is emitted as `event: result`. */
  emitResult?: boolean;
};

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
 */
export function sseGeneratorResponse(
  c: Context,
  gen: AsyncGenerator<unknown, unknown, unknown>,
  options: SseGeneratorOptions = {}
): Response {
  const { emitResult = false } = options;
  return streamSSE(c, async (stream) => {
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
          return;
        }
        await stream.writeSSE({ data: JSON.stringify(step.value) });
      }
      // Aborted; release the generator cleanly.
      await gen.return(undefined).catch(() => {
        /* swallow */
      });
    } catch (err) {
      await gen.return(undefined).catch(() => {
        /* swallow */
      });
      await stream.writeSSE({
        event: 'error',
        data: encodeErrorPayload(err),
      });
    }
  });
}

/**
 * Wrap a ReadableStream<T> (with T a JSON-encodable value) as an SSE response.
 * Each enqueued chunk is JSON-encoded and written as a `data:` event.
 */
export function sseReadableStreamResponse(
  c: Context,
  source: ReadableStream<unknown>
): Response {
  return streamSSE(c, async (stream) => {
    const reader = source.getReader();
    try {
      while (!stream.aborted) {
        const { done, value } = await reader.read();
        if (done) return;
        await stream.writeSSE({ data: JSON.stringify(value) });
      }
    } catch (err) {
      await stream.writeSSE({
        event: 'error',
        data: encodeErrorPayload(err),
      });
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
