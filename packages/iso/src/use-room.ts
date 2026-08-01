import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { Serialize } from './internal/serialize.js';
import {
  SOCKETS_RPC_PATH,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_KEY_PARAM,
  FORM_MODULE_FIELD,
  FORM_ROOM_FIELD,
} from './internal/contract.js';
import { decodeEnvelope } from './internal/room-envelope.js';
import type { PresenceMember, RoomEnvelope } from './internal/room-envelope.js';
import { useWsLifecycle } from './internal/ws-lifecycle.js';
import type {
  SocketStatus,
  SocketCloseInfo,
  ReconnectOptions,
} from './internal/ws-lifecycle.js';
import {
  createSignalRoster,
  type RosterStore,
} from './internal/roster-signal.js';
import { useComputed, useSignal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';

// Re-export the shared lifecycle types so consumers can name them off useRoom.
export type { SocketStatus, SocketCloseInfo, ReconnectOptions };

/**
 * The structural phantom shape `useRoom` reads message/state/param types from.
 * It deliberately carries ONLY the four phantom fields, not `RoomRef`'s
 * `useRoom` method: constraining on the full `RoomRef` (which references
 * `UseRoomOptions<RoomRef<...>>` in its own method) makes the constraint check
 * recurse through that method, which TS rejects as excessively deep. `RoomRef`
 * is structurally assignable to this shape, so callers pass a `RoomRef` as-is.
 *
 * Every field here is optional, so a plain `{}` DOES satisfy `R extends
 * AnyRoomRefShape` and `useRoom({})` type-checks with no compile error. See
 * `SocketRefShape`'s doc (use-socket.ts) for the full reasoning: a prior
 * REQUIRED `[RoomRefBrand]: true` phantom field closed this hole but broke
 * the released public `RoomRef` type for a hand-rolled mock or a
 * `const m: RoomRef<...> = {...}` annotation; a follow-up attempt requiring
 * the `useRoom` method itself (still no new required member on the value
 * side) reintroduced the identical excessively-deep recursion checking
 * `RoomRef<I,O,S,P>` against a shape whose `useRoom` method's own parameter
 * type references `RoomRef<I,O,S,P>` again. This constraint stays
 * field-only and accepts that `useRoom({})` compiles: it fails loudly at
 * runtime, not silently.
 */
type RoomRefShape<Incoming, Outgoing, State, Params> = {
  readonly [FORM_MODULE_FIELD]?: string;
  readonly [FORM_ROOM_FIELD]?: string;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  readonly __state?: State;
  readonly __params?: Params;
};

type AnyRoomRefShape = RoomRefShape<unknown, unknown, unknown, unknown>;

// Phantom-field extractors mirror the `Incoming`/`Outgoing` pattern in
// `use-socket.ts`. RoomRefShape<Incoming, Outgoing, State, Params>.
type Incoming<R> =
  R extends RoomRefShape<infer I, unknown, unknown, unknown> ? I : never;
type Outgoing<R> =
  R extends RoomRefShape<unknown, infer O, unknown, unknown> ? O : never;
type State<R> =
  R extends RoomRefShape<unknown, unknown, infer S, unknown> ? S : never;
type Params<R> =
  R extends RoomRefShape<unknown, unknown, unknown, infer P> ? P : never;

// `key` mirrors the channel's `KeyArgs`: a param-less channel makes `key`
// optional, a `:param` channel makes it required. Threading this through the
// opts object (rather than as a positional arg) keeps the single-opts shape.
//
// The no-params branch types `key` as `{ key?: never }` rather than
// `{ key?: P }`. `P` is `{}` for a param-less channel, and TS's structural
// `{}` accepts almost any object, so `{ key?: {} }` would silently accept a
// stray `key` value instead of rejecting it. `never` still declares the
// property (so both branches expose it for the castless `opts?.key` read
// below) but makes assigning anything to it a real type error. Mirrors
// `ParamsOption` in use-socket.ts.
type KeyOption<P> = keyof P extends never ? { key?: never } : { key: P };

export type UseRoomOptions<R extends AnyRoomRefShape> = KeyOption<Params<R>> & {
  /** Initial presence state, sent on open and re-sent on every reconnect. */
  presence?: State<R>;
  /**
   * Called for each application message. Does NOT trigger a re-render; per
   * message data goes here, never into reactive state.
   */
  onMessage?: (msg: Serialize<Outgoing<R>>, from: string) => void;
  /** Called when the connection opens. */
  onOpen?: () => void;
  /** Called when the connection closes. */
  onClose?: (e: CloseEvent) => void;
  /**
   * Predicate controlling whether to reconnect after a close event.
   * Default: false for code 1000 and 4000-4999, true otherwise.
   */
  shouldReconnect?: (e: CloseEvent) => boolean;
  reconnect?: ReconnectOptions;
  /**
   * When false the room will not connect (useful for conditional use).
   * Default: true.
   */
  enabled?: boolean;
};

export type UseRoomResult<R extends AnyRoomRefShape> = {
  // No client `broadcast`: fan-out is server-mediated. The client `send`s a
  // message and the room's server `onMessage` decides fan-out via the
  // server-side `conn.broadcast`. A client `broadcast` would duplicate `send`.
  send: (msg: Incoming<R>) => void;
  /** Publish this client's presence state to the roster. */
  setPresence: (state: State<R>) => void;
  /** The presence roster as a reactive value; changes on any join, leave or
   * presence update. Read `.value`. State may be undefined for rooms with no
   * presence() seed (void-state rooms).
   *
   * Reading `.value` during render subscribes that component to the WHOLE
   * roster, so it re-renders when anything about anyone changes. Bind
   * `member(id)` per row instead when the roster is large. */
  members: ReadonlySignal<ReadonlyArray<PresenceMember<State<R> | undefined>>>;
  /** Membership ids as a reactive value; changes on join/leave only. Read
   * `.value`. */
  memberIds: ReadonlySignal<readonly string[]>;
  /** One member's entry as a reactive value. `.value` changes only when THAT
   * member's presence changes, so a row bound to `member(id)` re-renders alone.
   *
   * The same signal is returned for a given id every time, for the room's
   * lifetime, so it is safe either to hold the binding as a prop or to call
   * `member(id)` again on a later render -- both subscribe identically.
   *
   * An id that is absent now yields a binding that goes live when that id
   * joins, and one whose member leaves goes to `undefined` rather than going
   * quiet, so a row can be rendered before its member arrives. */
  member: (
    id: string
  ) => ReadonlySignal<PresenceMember<State<R> | undefined> | undefined>;
  /** This client's own roster entry as a reactive value, derived from the
   * snapshot `self` id. Read `.value`; it is `undefined` until the first
   * server snapshot arrives. */
  self: ReadonlySignal<PresenceMember<State<R> | undefined> | undefined>;
  status: SocketStatus;
  close: (code?: number, reason?: string) => void;
  closeInfo?: SocketCloseInfo;
};

// The options argument itself is required exactly when the channel has
// params: a rest tuple, rather than a plain optional parameter, so
// `useRoom(ref)` with the options argument omitted ENTIRELY is a type error
// for a param-bearing channel (previously `opts` was merely optional, so
// omitting it compiled even when `KeyOption` required `key`; the hole only
// bit once an options object was actually passed). Exported so `RoomRef.useRoom`
// in define-room.ts spells the identical rest tuple instead of re-deriving it,
// keeping the free-function and ref-method arity rules single-sourced. Mirrors
// `UseSocketArgs` in use-socket.ts.
export type UseRoomArgs<R extends AnyRoomRefShape> =
  keyof Params<R> extends never
    ? [opts?: UseRoomOptions<R>]
    : [opts: UseRoomOptions<R>];

/**
 * Presence-aware room client hook: the room counterpart to `useSocket`. Opens
 * the same `/__sockets` connection with an extra `&r=<JSON key params>` query
 * param, decodes each `RoomEnvelope`, and maintains the presence roster
 * (`members` + `self`) as reactive state. Application messages route to
 * `opts.onMessage` only (no per-message re-render).
 */
export function useRoom<R extends AnyRoomRefShape>(
  ref: R,
  ...args: UseRoomArgs<R>
): UseRoomResult<R> {
  const opts = args[0];
  // The self id from the latest snapshot; `self` is derived from the store.
  // A signal, not state: `self` derives from it, and writing it must not
  // re-render the `useRoom` host any more than a presence frame does.
  const selfId = useSignal<string | undefined>(undefined);

  // The granular, signal-backed roster store. Created once per hook instance.
  const storeRef = useRef<RosterStore<State<R> | undefined> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createSignalRoster<State<R> | undefined>();
  }
  const store = storeRef.current;

  useEffect(() => () => store.dispose(), [store]);

  const moduleKey = ref[FORM_MODULE_FIELD];
  const roomName = ref[FORM_ROOM_FIELD];

  const enabled = opts?.enabled ?? true;
  // JSON-encode the key params once per render so the dep array is a stable
  // primitive; the server interpolates the topic from these params.
  const keyJson = JSON.stringify(opts?.key ?? {});

  const lifecycle = useWsLifecycle({
    enabled,
    ready: Boolean(moduleKey && roomName),
    deps: [moduleKey, roomName, keyJson],
    buildUrl: () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return (
        `${proto}//${location.host}${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(moduleKey!)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(roomName!)}` +
        `&${SOCKET_KEY_PARAM}=${encodeURIComponent(keyJson)}`
      );
    },
    onOpen: () => {
      opts?.onOpen?.();
      // Re-establish presence on (re)connect. The brief membership gap on
      // reconnect is expected; there is no replay of past messages.
      if (opts?.presence !== undefined) {
        sendPresenceFrame(opts.presence);
      }
    },
    onClose: (e) => opts?.onClose?.(e),
    shouldReconnect: opts?.shouldReconnect,
    reconnect: opts?.reconnect,
    onRawMessage: (raw) => {
      let env: RoomEnvelope<Serialize<Outgoing<R>>, State<R>>;
      try {
        // The sole cast lives inside decodeEnvelope (the JSON.parse wire
        // boundary); narrow the result via its discriminant below.
        env = decodeEnvelope<Serialize<Outgoing<R>>, State<R>>(raw);
      } catch {
        return;
      }
      // The store's signals drive re-renders, so no `setMembers` call is
      // needed on presence frames: that is what stops the whole `useRoom`
      // subtree from re-rendering on every update. `setSelfId` still fires
      // (rare, on snapshot).
      if (env.t === 'snapshot') {
        selfId.value = env.self;
        store.snapshot(env.members);
        return;
      }
      if (env.t === 'presence') {
        if (env.op === 'leave') {
          store.leave(env.from);
        } else {
          // join | update: upsert by id. State may be undefined for a room
          // with no presence() seed (a void-state room); the snapshot path
          // and the presence registry both treat undefined as a valid member
          // state, so we must not skip the upsert when env.state is absent.
          store.upsert(env.from, env.state);
        }
        return;
      }
      // env.t === 'msg': route to the callback only; no reactive state.
      opts?.onMessage?.(env.msg, env.from);
    },
  });

  const sendRaw = lifecycle.sendRaw;

  // The single presence-frame encoder, used by both `setPresence` and the
  // on-open presence seed. A plain closure over the stable `sendRaw` (not
  // memoized) so the lifecycle's `onOpen` always sees the latest binding.
  function sendPresenceFrame(state: State<R>): void {
    sendRaw(JSON.stringify({ t: 'presence', state }));
  }

  const send = useCallback(
    (msg: Incoming<R>) => {
      sendRaw(JSON.stringify({ t: 'msg', msg }));
    },
    [sendRaw]
  );

  const setPresence = useCallback(
    (state: State<R>) => sendPresenceFrame(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sendRaw]
  );

  // `self` derives from the snapshot's self id and that member's own signal, so
  // a self presence echo notifies a `self` reader without re-rendering
  // `useRoom`. Relies on the server seeding self into the roster before the
  // snapshot (room-engine `joinPresence` precedes `roster`), so `member(sid)`
  // resolves to a real signal.
  const self = useComputed(() => {
    const sid = selfId.value;
    return sid === undefined ? undefined : store.member(sid).value;
  });

  // Every roster read is a SIGNAL, so the type says what it does. `members`,
  // `memberIds` and `member(id)` now behave identically: reading `.value` in a
  // tracking context subscribes that reader, and outside one the signal is
  // still there to `.subscribe()` from.
  //
  // `members` was a lazy getter returning the array itself (review round 3, T3).
  // That read subscribed a consumer during render, but an imperative consumer
  // reading it in a `useEffect` got a dead snapshot and no way to notice: the
  // type said `ReadonlyArray`, so nothing suggested there was anything to
  // subscribe to, and `useRoom` no longer re-renders on presence frames.
  return {
    send,
    setPresence,
    members: store.members,
    memberIds: store.memberIds,
    member: store.member,
    self,
    status: lifecycle.status,
    close: lifecycle.close,
    closeInfo: lifecycle.closeInfo,
  };
}
