import type { Context } from 'hono';
import type { Middleware } from './define-middleware.js';
import type { Channel } from './define-channel.js';
import type { RouteParams } from './internal/typed-routes.js';
import { FORM_MODULE_FIELD, FORM_ROOM_FIELD } from './internal/contract.js';
import {
  useRoom,
  type UseRoomOptions,
  type UseRoomResult,
} from './use-room.js';

/**
 * The per-connection handle handed to a room's server handlers.
 *
 * Unlike a plain socket (which only ever touches its own connection), a room
 * connection can also `broadcast` to every other member and publish its own
 * `presence` state to the roster. `send`/`broadcast` take the server->client
 * `Outgoing` type; per-connection state lives on `data`.
 */
export interface RoomConnection<Outgoing, State, Data> {
  /** This connection's stable member id (used as the presence roster key). */
  readonly id: string;
  /** Send a message to this one connection. */
  send(msg: Outgoing): void;
  /**
   * Broadcast a message to every other member of the room. Pass
   * `{ self: true }` to also deliver it back to this connection (implemented
   * server-side as a direct local send; no extra wire flag).
   */
  broadcast(msg: Outgoing, opts?: { self?: boolean }): void;
  /** Publish this connection's presence state to the roster. */
  setPresence(state: State): void;
  /**
   * Per-connection state, seeded once at the edge by the room's `data()`
   * factory, read-only for cross-runtime portability. An in-place mutation is
   * NOT guaranteed to persist across events (on Cloudflare each event reads a
   * freshly deserialized attachment). Use `setPresence` for state that evolves;
   * for Node-only mutable state, capture a closure variable in `onJoin()`.
   */
  data: Readonly<Data>;
  /** Close this connection. */
  close(code?: number, reason?: string): void;
}

/**
 * The server-side handler for a room. Mirrors `SocketHandler`, but adds
 * presence (`presence` seeds the joining member's initial state) and the
 * broadcast affordances on `RoomConnection`.
 *
 * `onJoin`'s `ctx.params` is typed from the CHANNEL name pattern, not the
 * route: the room key rides the wire (the `&r=channel.key(params)` query
 * param), so the channel is the only param source available at runtime on the
 * flat `/__sockets` endpoint.
 */
export interface RoomHandler<Incoming, Outgoing, State, Data, Params> {
  /** Guard/middleware chain run before the upgrade; a deny closes 4403. */
  use?: ReadonlyArray<Middleware>;
  /** Seed the joining member's initial presence state. */
  presence?: () => State;
  /**
   * Runs at the edge (the worker) with the live Hono Context, on both Node and
   * Cloudflare. The factory may be async. Its serializable result seeds
   * `conn.data`, which is then available in onJoin and onMessage. Use it to
   * capture request-derived data (the authenticated user, a header) since the
   * room callbacks run without a live Context (inside a Durable Object on
   * Cloudflare).
   */
  data?: (c: Context) => Data | Promise<Data>;
  /**
   * Per-connection setup. May return a teardown fn called on leave.
   *
   * `ctx.params` is the channel-name params recovered from the room key on the
   * wire. Request-derived data captured at the edge lives on `conn.data`
   * (seeded by the `data` factory above).
   */
  onJoin?(
    conn: RoomConnection<Outgoing, State, Data>,
    ctx: { params: Params }
  ): void | (() => void) | Promise<void | (() => void)>;
  onMessage?(
    conn: RoomConnection<Outgoing, State, Data>,
    msg: Incoming
  ): void | Promise<void>;
  onLeave?(conn: RoomConnection<Outgoing, State, Data>): void;
  onError?(conn: RoomConnection<Outgoing, State, Data>, err: unknown): void;
}

/**
 * The runtime def the server registry reads (Task 4). It is the `RoomHandler`
 * plus the bound `channel`. The presence of `channel` is the discriminator
 * that distinguishes a `RoomDef` from a `SocketDef` (which never carries a
 * `channel`); the shared socket/room registry branches on it. `__moduleKey` /
 * `__roomName` are threaded by the build (the prepended `__moduleKey` export +
 * the client stub), so they are optional here and unused on the server (the
 * registry keys by the module's own `__moduleKey` + the `serverRooms`
 * property name).
 */
export interface RoomDef<
  Incoming,
  Outgoing,
  State,
  Data,
  Params,
> extends RoomHandler<Incoming, Outgoing, State, Data, Params> {
  /** The channel this room is bound to. The discriminator vs a `SocketDef`. */
  readonly channel: Channel<string, unknown>;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  readonly __state?: State;
}

/**
 * The client-facing reference. On the server it is the `RoomDef`; on the client
 * the `.server` import is stripped to a `{ __module, __room }` descriptor. The
 * message/state/param types ride phantom fields so the rooms client hook infers
 * them: `__incoming`/`__outgoing` (the duplex message types), `__state` (the
 * presence state), and `__params` (the channel-name params, so `useRoom`'s
 * `opts.key` is typed from the channel).
 *
 * The `useRoom` ref-method mirrors `SocketRef.useSocket`: it is the type for the
 * codegen-attached `.useRoom` runtime method, so a room can be consumed as
 * `serverRooms.board.useRoom({ key })`.
 */
export interface RoomRef<Incoming, Outgoing, State, Params> {
  readonly [FORM_MODULE_FIELD]?: string;
  readonly [FORM_ROOM_FIELD]?: string;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  readonly __state?: State;
  readonly __params?: Params;
  /**
   * Idiomatic ref-method form of `useRoom`. Equivalent to
   * `useRoom(ref, opts)` but called directly on the ref:
   * `serverRooms.board.useRoom({ key: { roomId } })`.
   */
  useRoom(
    opts?: UseRoomOptions<RoomRef<Incoming, Outgoing, State, Params>>
  ): UseRoomResult<RoomRef<Incoming, Outgoing, State, Params>>;
}

/**
 * Define a typed broadcasting room bound to a `Channel`. Place it in a
 * `serverRooms` map in a `.server` module; consume it with the rooms client
 * hook. The channel's name pattern (`defineChannel('room/:roomId')`) carries
 * the room-key params, which type `onJoin`'s `ctx.params`.
 *
 * The handler can `broadcast` to other members and publish `presence` state;
 * `presence` seeds the joining member's initial state. `onJoin` may return a
 * teardown fn.
 */
export function defineRoom<
  Name extends string,
  Payload,
  State = void,
  Data = Record<string, unknown>,
>(
  channel: Channel<Name, Payload>,
  handler: RoomHandler<Payload, Payload, State, Data, RouteParams<Name>>
): RoomRef<Payload, Payload, State, RouteParams<Name>> {
  // The def (handler + channel) IS the runtime value on the server; the type
  // presents as a client `RoomRef`. The build strips the body on the client and
  // replaces it with the descriptor stub, so this object only runs server-side.
  // Single sanctioned cast: the def-doubles-as-client-ref boundary, identical
  // to how `defineSocket` returns a server def typed as `SocketRef`. The cast is
  // bounded to this one return site.
  const def: RoomDef<Payload, Payload, State, Data, RouteParams<Name>> = {
    ...handler,
    channel,
  };
  const ref = def as unknown as RoomRef<
    Payload,
    Payload,
    State,
    RouteParams<Name>
  >;
  // Attach the `.useRoom` ref-method to the def itself. On the client the
  // `.server` import is replaced by a stub that attaches its own `.useRoom`, but
  // the build skips that transform for SSR, so a server-rendered component that
  // calls `serverRooms.x.useRoom(...)` runs against this real def. Without the
  // method, SSR throws "useRoom is not a function" (a bare 500). The def carries
  // no module/room key, so the hook stays disconnected during SSR (opening no
  // socket) and the markup matches the client's first hydration render.
  ref.useRoom = (opts) => useRoom(ref, opts);
  return ref;
}
