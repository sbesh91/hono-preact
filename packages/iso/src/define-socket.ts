import type { Context } from 'hono';
import type { Middleware } from './define-middleware.js';
import { FORM_MODULE_FIELD, FORM_SOCKET_FIELD } from './internal/contract.js';
import type { ReadonlyData } from './internal/readonly-data.js';
import {
  useSocket,
  type UseSocketOptions,
  type UseSocketResult,
} from './use-socket.js';

/** The per-connection socket handle handed to the server handlers. */
export interface ServerSocket<Outgoing, Data> {
  send(message: Outgoing): void;
  close(code?: number, reason?: string): void;
  /** Per-connection data seeded by the `data` factory at connect time, read-only
   * for cross-runtime portability. On Cloudflare the DO is hibernatable, so each
   * event re-reads the connect-time value and an in-place mutation does not
   * persist. For Node-only mutable per-connection state, capture a closure
   * variable in `open()` instead of writing to `data`. */
  data: ReadonlyData<Data>;
  /** The underlying runtime socket (escape hatch). */
  readonly raw: unknown;
}

export interface SocketHandler<Incoming, Outgoing, Data, Params = {}> {
  /** Guard/middleware chain run before the upgrade; a deny closes 4403. */
  use?: ReadonlyArray<Middleware>;
  /**
   * Edge factory run once at the upgrade with the live Hono Context; its
   * result seeds `socket.data`. The factory may be async. This is the ONLY
   * place a socket handler sees a Context: on Cloudflare the connection runs
   * inside a Durable Object with no live Context, so read cookies, headers,
   * query, and middleware-set values here. Runs on both Node and Cloudflare.
   *
   * The second argument is the route's params, validated at the upgrade:
   * `RouteParams<RouteId>` when bound via `serverRoute(r).socket`, or `{}` for
   * a bare `defineSocket`.
   *
   * `socket.data` is the connect-time seed and is read-only: each event reads
   * the original factory value (on Cloudflare the DO is hibernatable and does
   * not share in-memory state across events). For per-connection state that
   * evolves during the connection, capture a closure variable in `open()` on
   * Node, or use external storage (Durable Object storage, KV, etc.) for state
   * that must survive across messages on Cloudflare. Keep the factory result
   * small: it rides a request header to the Durable Object, so large results
   * can fail the upgrade.
   */
  data?: (c: Context, params: Params) => Data | Promise<Data>;
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
export interface SocketDef<
  Incoming,
  Outgoing,
  Data,
  Params = {},
> extends SocketHandler<Incoming, Outgoing, Data, Params> {
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  /**
   * The declared route pattern when constructed via `serverRoute(r).socket`.
   * Read by the boot binding guard (fail-closed validation against the module
   * mount, or the route table for src/server registry modules) and by
   * connection resolution, where it takes precedence over the module-mount
   * derivation for the page-use (auth) chain. Absent on bare `defineSocket`
   * defs, which stay route-independent.
   */
  readonly __routeId?: string;
}

/**
 * The client-facing reference. On the server it is the SocketDef; on the client
 * the `.server` import is stripped to a `{ __module, __socket }` descriptor. The
 * message and param types ride phantom fields so `useSocket(ref)` infers them:
 * `__incoming`/`__outgoing` (the duplex message types) and `__params` (the
 * route's params, so `useSocket(ref, { params })` is typed).
 */
export interface SocketRef<Incoming, Outgoing, Params = {}> {
  readonly [FORM_MODULE_FIELD]?: string;
  readonly [FORM_SOCKET_FIELD]?: string;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  /**
   * The declared route pattern's params when constructed via
   * `serverRoute(r).socket`, so `useSocket(ref, { params })` is typed and
   * required for a param-bearing binding. `{}` for a bare `defineSocket`.
   */
  readonly __params?: Params;
  /**
   * Idiomatic ref-method form of `useSocket`. Equivalent to
   * `useSocket(ref, opts)` but called directly on the ref:
   * `serverSockets.feed.useSocket({ onMessage })`.
   */
  useSocket(
    opts?: UseSocketOptions<SocketRef<Incoming, Outgoing, Params>>
  ): UseSocketResult<SocketRef<Incoming, Outgoing, Params>>;
}

function makeSocketRef<Incoming, Outgoing, Data, Params>(
  handler: SocketHandler<Incoming, Outgoing, Data, Params>,
  routeId?: string
): SocketRef<Incoming, Outgoing, Params> {
  // A copy of the handler IS the runtime def on the server; the type presents
  // as a client SocketRef. The build strips the body on the client and replaces
  // it with the descriptor stub, so this object only runs server-side.
  // Single sanctioned cast: the def-doubles-as-client-ref pattern, identical
  // to how defineAction returns a server fn typed as ActionRef (action.ts
  // uses `return fn as unknown as ActionRef<...>`). The cast is bounded to
  // this one return site.
  const ref = {
    ...handler,
    ...(routeId !== undefined ? { __routeId: routeId } : {}),
  } as unknown as SocketRef<Incoming, Outgoing, Params>;
  // Attach the `.useSocket` ref-method to the def itself, for the same reason
  // `defineRoom` attaches `.useRoom`: SSR skips the `.server`->stub transform,
  // so a server-rendered component calling `serverSockets.x.useSocket(...)` runs
  // against this real def and would otherwise throw "useSocket is not a
  // function" (a bare 500). Without a module/socket key the hook stays
  // disconnected during SSR, matching the client's first hydration render.
  ref.useSocket = (opts) => useSocket(ref, opts);
  return ref;
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
  return makeSocketRef(handler);
}

/**
 * Internal constructor behind `serverRoute(r).socket`: a `defineSocket` that
 * stamps the declared route pattern as `__routeId`, so the boot binding guard
 * validates the binding fail-closed and connection resolution resolves the
 * route's page-use (auth) chain from it. Framework-private; not part of the
 * public API.
 */
export function _defineRouteSocket<
  Incoming,
  Outgoing,
  Data = undefined,
  Params = {},
>(
  routeId: string,
  handler: SocketHandler<Incoming, Outgoing, Data, Params>
): SocketRef<Incoming, Outgoing, Params> {
  return makeSocketRef(handler, routeId);
}
