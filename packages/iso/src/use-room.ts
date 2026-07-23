import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
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
import { createDefaultRoster } from './internal/default-roster.js';
import {
  getPresenceReactiveImpl,
  type ReadonlyReactive,
  type RosterStore,
} from './internal/reactive.js';

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
  /** The presence roster, reactive. State may be undefined for rooms with no
   * presence() seed (void-state rooms). */
  members: ReadonlyArray<PresenceMember<State<R> | undefined>>;
  /** Membership ids as a reactive value; changes on join/leave only. Read
   * `.value`. With the `hono-preact/signals` entry imported this is a granular
   * signal; otherwise it reads coarsely through `members`. */
  memberIds: ReadonlyReactive<readonly string[]>;
  /** One member's entry as a reactive value. With the signals entry imported,
   * `.value` changes only when THAT member's presence changes, so a row bound to
   * `member(id)` re-renders alone. Read `.value` in render, and only for ids
   * currently in `memberIds`: a binding created for an absent id does not observe
   * that id later joining (re-read `member(id)` fresh each render, as the keyed
   * `memberIds.value.map(...)` pattern does). Without the signals entry it reads
   * coarsely through `members`. */
  member: (
    id: string
  ) => ReadonlyReactive<PresenceMember<State<R> | undefined> | undefined>;
  /** This client's own roster entry, derived from the snapshot `self` id. */
  self?: PresenceMember<State<R> | undefined>;
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
  const [members, setMembers] = useState<
    ReadonlyArray<PresenceMember<State<R> | undefined>>
  >([]);
  // The self id from the latest snapshot; `self` is derived from `members`.
  const [selfId, setSelfId] = useState<string | undefined>(undefined);

  // Track the latest members array so the signals-free default store can read
  // through to it.
  const membersRef = useRef(members);
  membersRef.current = members;

  // The granular roster store: the signal-backed impl when the signals entry is
  // imported, otherwise the signals-free default over the members array. Created
  // once per hook instance. `signalMode` is recorded here (not re-derived per
  // render) so it stays consistent with the store that was actually created.
  const storeRef = useRef<{
    store: RosterStore<State<R> | undefined>;
    signalMode: boolean;
  } | null>(null);
  if (storeRef.current === null) {
    const impl = getPresenceReactiveImpl();
    storeRef.current = impl
      ? { store: impl.createRoster<State<R> | undefined>(), signalMode: true }
      : {
          store: createDefaultRoster<State<R> | undefined>(
            () => membersRef.current
          ),
          signalMode: false,
        };
  }
  const { store, signalMode } = storeRef.current;

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
      // In signal mode the store's signals drive re-renders, so `setMembers` is
      // deliberately NOT called on presence frames: that is what stops the whole
      // `useRoom` subtree from re-rendering on every update. `setSelfId` still
      // fires (rare, on snapshot). In default mode `setMembers` is the reactive
      // source and drives the coarse re-render.
      if (env.t === 'snapshot') {
        setSelfId(env.self);
        if (!signalMode) setMembers(env.members);
        store.snapshot(env.members);
        return;
      }
      if (env.t === 'presence') {
        if (env.op === 'leave') {
          if (!signalMode)
            setMembers((prev) => prev.filter((m) => m.id !== env.from));
          store.leave(env.from);
        } else {
          // join | update: upsert by id. State may be undefined for a room
          // with no presence() seed (a void-state room); the snapshot path
          // and the presence registry both treat undefined as a valid member
          // state, so we must not skip the upsert when env.state is absent.
          if (!signalMode)
            setMembers((prev) => upsertMember(prev, env.from, env.state));
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

  // Keep the latest self id reachable from the result getters without forcing a
  // `useRoom` re-render: `selfId` only changes via `setSelfId` (on snapshot),
  // which re-renders anyway, so this ref is current whenever it matters.
  const selfIdRef = useRef(selfId);
  selfIdRef.current = selfId;

  // `members` and `self` are lazy getters. In signal mode they read the store's
  // signals when the CONSUMER accesses them, so a coarse `members` consumer
  // subscribes to the whole roster (updates on any change) while a component
  // that reads only `member(id)` does not re-render on other members. In default
  // mode they return the `useState` value / an array `find`, coarse as before.
  return {
    send,
    setPresence,
    get members() {
      return signalMode ? store.members.value : members;
    },
    memberIds: store.memberIds,
    member: store.member,
    get self() {
      const sid = selfIdRef.current;
      if (sid === undefined) return undefined;
      // In signal mode this subscribes the consumer to self's OWN signal, so a
      // self presence echo re-renders a `self` reader without re-rendering
      // useRoom. Relies on the server seeding self into the roster before the
      // snapshot (room-engine joinPresence precedes roster), so `member(sid)`
      // resolves to a real signal; a protocol violation (self id absent from
      // the roster) would not recover on a later join here, unlike default mode.
      return signalMode
        ? store.member(sid).value
        : members.find((m) => m.id === sid);
    },
    status: lifecycle.status,
    close: lifecycle.close,
    closeInfo: lifecycle.closeInfo,
  };
}

/** Upsert a member by id: replace state in place, or append a new entry. */
function upsertMember<S>(
  prev: ReadonlyArray<PresenceMember<S>>,
  id: string,
  state: S
): ReadonlyArray<PresenceMember<S>> {
  const next = prev.slice();
  const i = next.findIndex((m) => m.id === id);
  const entry: PresenceMember<S> = { id, state };
  if (i === -1) {
    next.push(entry);
  } else {
    next[i] = entry;
  }
  return next;
}
