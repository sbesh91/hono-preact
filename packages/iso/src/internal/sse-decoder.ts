export type SSEEvent = { event: string; data: string };

function lineSplitTransform(): TransformStream<string, string> {
  let buffer = '';
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        controller.enqueue(buffer.slice(0, nl).replace(/\r$/, ''));
        buffer = buffer.slice(nl + 1);
      }
    },
    flush(controller) {
      if (buffer.length) {
        controller.enqueue(buffer.replace(/\r$/, ''));
        buffer = '';
      }
    },
  });
}

export async function* readSSE(
  stream: ReadableStream<BufferSource>
): AsyncGenerator<SSEEvent, void, unknown> {
  const lines = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(lineSplitTransform());

  let event = 'message';
  let dataLines: string[] = [];
  const reader = (lines as ReadableStream<string>).getReader();
  try {
    while (true) {
      const { done, value: line } = await reader.read();
      if (done) {
        if (dataLines.length) {
          yield { event, data: dataLines.join('\n') };
        }
        return;
      }
      if (line === '') {
        if (dataLines.length) {
          yield { event, data: dataLines.join('\n') };
        }
        event = 'message';
        dataLines = [];
      } else if (line.startsWith(':')) {
        // SSE comment / keepalive, ignore
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
