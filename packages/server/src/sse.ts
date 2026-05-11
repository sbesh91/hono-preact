const ENCODER = new TextEncoder();

export function sseEncode(event: { event?: string; data: string }): Uint8Array {
  const prefix = event.event ? `event: ${event.event}\n` : '';
  return ENCODER.encode(`${prefix}data: ${event.data}\n\n`);
}

export const SSE_KEEPALIVE = ENCODER.encode(': keepalive\n\n');

export function sseEncodeError(err: unknown): Uint8Array {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : 'Error';
  return sseEncode({ event: 'error', data: JSON.stringify({ message, name }) });
}

export type SseFromGeneratorOptions = {
  emitResult?: boolean;
  signal?: AbortSignal;
};

export function sseFromGenerator(
  gen: AsyncGenerator<unknown, unknown, unknown>,
  options: SseFromGeneratorOptions
): ReadableStream<Uint8Array> {
  const { emitResult = false, signal } = options;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const onAbort = () => {
        gen.return(undefined).catch(() => { /* swallow */ });
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          controller.close();
          return;
        }
        signal.addEventListener('abort', onAbort);
      }

      try {
        while (true) {
          const step = await gen.next();
          if (step.done) {
            if (emitResult && step.value !== undefined) {
              controller.enqueue(
                sseEncode({ event: 'result', data: JSON.stringify(step.value) })
              );
            }
            break;
          }
          controller.enqueue(sseEncode({ data: JSON.stringify(step.value) }));
        }
      } catch (err) {
        controller.enqueue(sseEncodeError(err));
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        controller.close();
      }
    },
    cancel() {
      gen.return(undefined).catch(() => { /* swallow */ });
    },
  });
}

export function isAsyncGenerator(
  value: unknown
): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function' &&
    typeof (value as { next?: unknown }).next === 'function'
  );
}

export function readableStreamToSse(
  stream: ReadableStream<unknown>
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(sseEncode({ data: JSON.stringify(value) }));
        }
      } catch (err) {
        controller.enqueue(sseEncodeError(err));
      } finally {
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => { /* swallow */ });
    },
  });
}
