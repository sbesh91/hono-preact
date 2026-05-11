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
