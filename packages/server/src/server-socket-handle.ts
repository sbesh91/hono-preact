/**
 * Build the per-connection ServerSocket handle over a runtime socket. Shared by
 * the Node in-worker path (sockets-handler) and the Cloudflare Durable Object
 * path (realtime-do-glue) so the handle contract (`send` JSON-encodes; `data`
 * is the edge-captured bag; `raw` is the escape hatch) is defined exactly once.
 */
export function makeServerSocketHandle(
  ws: { send(d: string): void; close(code?: number, reason?: string): void },
  data: unknown
): {
  send(msg: unknown): void;
  close(code?: number, reason?: string): void;
  data: unknown;
  raw: unknown;
} {
  return {
    send: (msg: unknown) => ws.send(JSON.stringify(msg)),
    close: (code?: number, reason?: string) => ws.close(code, reason),
    data,
    raw: ws,
  };
}
