// Pure Node <-> Fetch translation for the dev server's SSR middleware. Extracted
// from `node-dev-server.ts`'s `configureServer` body so the riskiest dev-only
// runtime path (header copy, request-body buffering, streamed response
// writeback) is covered by fast unit tests rather than only the gated
// `websocket-dev.test.ts` integration suite. The structural `*Like` types are a
// subset of Node's `http.IncomingMessage`/`ServerResponse`, so the real Connect
// req/res satisfy them while unit tests pass plain mocks.

/** The `http.IncomingMessage` fields the translation reads (plus its body, via
 * async iteration). */
export interface NodeRequestLike extends AsyncIterable<Uint8Array> {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

/** The `http.ServerResponse` sink the translation writes to. */
export interface NodeResponseLike {
  statusCode: number;
  setHeader(key: string, value: string): void;
  write(chunk: Uint8Array): void;
  end(): void;
}

/**
 * Translate a Node request into a Fetch `Request`. Copies headers (string and
 * repeated/array forms) and, for methods that carry a body, buffers the stream
 * into a fresh `ArrayBuffer` (sidestepping `Buffer<ArrayBufferLike>` BodyInit
 * friction). GET/HEAD never read a body.
 */
export async function toFetchRequest(req: NodeRequestLike): Promise<Request> {
  const url = `http://${req.headers.host}${req.url}`;
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
  }
  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Uint8Array[] = [];
    for await (const c of req) chunks.push(c);
    if (chunks.length) {
      const buf = Buffer.concat(chunks);
      body = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      ) as ArrayBuffer;
    }
  }
  return new Request(url, { method, headers, body });
}

/**
 * Write a Fetch `Response` back to a Node response: status, headers, then the
 * body streamed chunk-by-chunk (so a streaming SSR response is flushed
 * incrementally rather than buffered).
 */
export async function writeFetchResponse(
  res: NodeResponseLike,
  response: Response
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}
