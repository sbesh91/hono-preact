import { createServer as createNetServer } from 'node:net';

/** Poll until the server answers anything at all, or time out. */
export async function waitForServer(
  port: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`server on :${port} never became reachable`);
}

/**
 * Ask the OS for a free port, then hand the number to the child.
 *
 * Both servers are spawned as child processes that bind their own listener, so
 * there is no socket handle to read an ephemeral port back off of; the port has
 * to be chosen up front. Hard-coding one risks a collision with whatever else
 * is listening on a developer's machine or a CI runner, which would surface as
 * the deeply confusing "server never became reachable" (we would be polling
 * someone else's server, or losing the bind race). Binding to :0 and releasing
 * immediately is the standard way to get a number the OS just confirmed is
 * free. The tiny race between release and re-bind is acceptable here: this
 * suite runs with `fileParallelism: false` and one target at a time.
 */
export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createNetServer();
    srv.once('error', rej);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}
