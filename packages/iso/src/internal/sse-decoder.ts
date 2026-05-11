export type SSEEvent = { event: string; data: string };

export async function* readSSE(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let dataLines: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (dataLines.length) yield { event, data: dataLines.join('\n') };
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);

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
    }
  } finally {
    reader.releaseLock();
  }
}
