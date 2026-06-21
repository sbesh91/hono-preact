import type { Context } from 'hono';
import type { Middleware } from './define-middleware.js';
import { FORM_MODULE_FIELD, FORM_SOCKET_FIELD } from './internal/contract.js';

/** The per-connection socket handle handed to the server handlers. */
export interface ServerSocket<Outgoing, Data> {
  send(message: Outgoing): void;
  close(code?: number, reason?: string): void;
  data: Data;
  /** The underlying runtime socket (escape hatch). */
  readonly raw: unknown;
}

export interface SocketHandler<Incoming, Outgoing, Data, Params> {
  /** Guard/middleware chain run before the upgrade; a deny closes 4403. */
  use?: ReadonlyArray<Middleware>;
  /** Per-connection setup. May return a teardown fn called on close. */
  open?(
    socket: ServerSocket<Outgoing, Data>,
    ctx: { c: Context; params: Params }
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
  Data,
  Record<string, string>
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
}

/**
 * Define a typed duplex WebSocket. Place it in a `serverSockets` map in a
 * `.server` module; consume it with `useSocket(serverSockets.x)`.
 *
 * The handler only ever touches its own connection (`socket`); per-connection
 * state lives on `socket.data`. `open` may return a teardown fn.
 */
export function defineSocket<Incoming, Outgoing, Data = undefined>(
  handler: SocketHandler<Incoming, Outgoing, Data, Record<string, string>>
): SocketRef<Incoming, Outgoing> {
  // The handler IS the runtime def on the server; the type presents as a
  // client SocketRef. The build strips the body on the client and replaces it
  // with the descriptor stub, so this object only runs server-side.
  // Single sanctioned cast: the def-doubles-as-client-ref pattern, identical
  // to how defineAction returns a server fn typed as ActionStub (action.ts
  // uses `return fn as unknown as ActionStub<...>`). The cast is bounded to
  // this one return site.
  return handler as unknown as SocketRef<Incoming, Outgoing>;
}
