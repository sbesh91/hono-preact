import type { Context } from 'hono';
import type { Middleware } from './define-middleware.js';
import { FORM_MODULE_FIELD, FORM_SOCKET_FIELD } from './internal/contract.js';
import {
  useSocket,
  type UseSocketOpts,
  type UseSocketResult,
} from './use-socket.js';

/** The per-connection socket handle handed to the server handlers. */
export interface ServerSocket<Outgoing, Data> {
  send(message: Outgoing): void;
  close(code?: number, reason?: string): void;
  data: Data;
  /** The underlying runtime socket (escape hatch). */
  readonly raw: unknown;
}

export interface SocketHandler<Incoming, Outgoing, Data> {
  /** Guard/middleware chain run before the upgrade; a deny closes 4403. */
  use?: ReadonlyArray<Middleware>;
  /**
   * Edge factory run once at the upgrade with the live Hono Context; its
   * result seeds `socket.data`. This is the ONLY place a socket handler sees a
   * Context: on Cloudflare the connection runs inside a Durable Object with no
   * live Context, so read cookies, headers, query, and middleware-set values
   * here and stash them on `socket.data`. Runs on both Node and Cloudflare.
   */
  data?: (c: Context) => Data;
  /**
   * Per-connection setup. Receives only the socket (its `data` is the `data`
   * factory result). May return a teardown fn.
   *
   * On Cloudflare the connection is hibernatable, so a returned teardown
   * cannot survive a hibernation cycle; it is a Node-only convenience. Use
   * `close` for cleanup that must run on both runtimes.
   */
  open?(
    socket: ServerSocket<Outgoing, Data>
  ): void | (() => void) | Promise<void | (() => void)>;
  message?(
    socket: ServerSocket<Outgoing, Data>,
    message: Incoming
  ): void | Promise<void>;
  close?(
    socket: ServerSocket<Outgoing, Data>,
    ev: { code: number; reason: string }
  ): void;
  error?(socket: ServerSocket<Outgoing, Data>, err: unknown): void;
}

// The runtime def the server registry reads. __moduleKey/__socketName are
// threaded by the build (the prepended __moduleKey export + the client stub),
// so they are optional here and unused on the server (the registry keys by the
// module's own __moduleKey + the serverSockets property name).
export interface SocketDef<Incoming, Outgoing, Data> extends SocketHandler<
  Incoming,
  Outgoing,
  Data
> {
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
}

/**
 * The client-facing reference. On the server it is the SocketDef; on the client
 * the `.server` import is stripped to a `{ __module, __socket }` descriptor. The
 * message types ride phantom fields so `useSocket(ref)` infers them.
 */
export interface SocketRef<Incoming, Outgoing> {
  readonly [FORM_MODULE_FIELD]?: string;
  readonly [FORM_SOCKET_FIELD]?: string;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  /**
   * Idiomatic ref-method form of `useSocket`. Equivalent to
   * `useSocket(ref, opts)` but called directly on the ref:
   * `serverSockets.feed.useSocket({ onMessage })`.
   */
  useSocket(
    opts?: UseSocketOpts<SocketRef<Incoming, Outgoing>>
  ): UseSocketResult<SocketRef<Incoming, Outgoing>>;
}

/**
 * Define a typed duplex WebSocket. Place it in a `serverSockets` map in a
 * `.server` module; consume it with `useSocket(serverSockets.x)`.
 *
 * The handler only ever touches its own connection (`socket`); per-connection
 * state lives on `socket.data`. `open` may return a teardown fn.
 */
export function defineSocket<Incoming, Outgoing, Data = undefined>(
  handler: SocketHandler<Incoming, Outgoing, Data>
): SocketRef<Incoming, Outgoing> {
  // A copy of the handler IS the runtime def on the server; the type presents
  // as a client SocketRef. The build strips the body on the client and replaces
  // it with the descriptor stub, so this object only runs server-side.
  // Single sanctioned cast: the def-doubles-as-client-ref pattern, identical
  // to how defineAction returns a server fn typed as ActionStub (action.ts
  // uses `return fn as unknown as ActionStub<...>`). The cast is bounded to
  // this one return site.
  const ref = { ...handler } as unknown as SocketRef<Incoming, Outgoing>;
  // Attach the `.useSocket` ref-method to the def itself, for the same reason
  // `defineRoom` attaches `.useRoom`: SSR skips the `.server`->stub transform,
  // so a server-rendered component calling `serverSockets.x.useSocket(...)` runs
  // against this real def and would otherwise throw "useSocket is not a
  // function" (a bare 500). Without a module/socket key the hook stays
  // disconnected during SSR, matching the client's first hydration render.
  ref.useSocket = (opts) => useSocket(ref, opts);
  return ref;
}
