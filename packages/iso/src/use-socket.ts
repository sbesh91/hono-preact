import { useCallback, useState } from 'preact/hooks';
import type { Serialize } from './internal/serialize.js';
import {
  SOCKETS_RPC_PATH,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_KEY_PARAM,
  FORM_MODULE_FIELD,
  FORM_SOCKET_FIELD,
} from './internal/contract.js';
import { useWsLifecycle } from './internal/ws-lifecycle.js';
import type {
  SocketStatus,
  SocketCloseInfo,
  ReconnectOptions,
} from './internal/ws-lifecycle.js';

// Re-export the shared lifecycle types so the public surface is unchanged.
export type { SocketStatus, SocketCloseInfo, ReconnectOptions };

/**
 * Structural phantom shape `useSocket` reads types from. Carries ONLY the
 * phantom fields, not `SocketRef`'s `useSocket` method: constraining on the
 * full `SocketRef` (whose method references `UseSocketOptions<SocketRef<...>>`)
 * makes the constraint recurse through that method, which TS rejects as
 * excessively deep. Mirrors `RoomRefShape` in use-room.ts.
 */
type SocketRefShape<Incoming, Outgoing, Params> = {
  readonly [FORM_MODULE_FIELD]?: string;
  readonly [FORM_SOCKET_FIELD]?: string;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  readonly __params?: Params;
};
type AnySocketRefShape = SocketRefShape<unknown, unknown, unknown>;

type Incoming<R> =
  R extends SocketRefShape<infer I, unknown, unknown> ? I : never;
type Outgoing<R> =
  R extends SocketRefShape<unknown, infer O, unknown> ? O : never;
type ParamsOf<R> =
  R extends SocketRefShape<unknown, unknown, infer P> ? P : never;

// `params` mirrors the room's `KeyOption`, with one deliberate divergence: a
// param-less binding types `params` as `{ params?: never }` rather than
// `{ params?: P }`. `P` is `{}` for a bare socket, and TS's structural `{}`
// accepts almost any object, so `{ params?: {} }` would silently accept a
// stray `params` value instead of rejecting it. `never` still declares the
// property (so both branches expose it for the castless `opts?.params` read
// below) but makes assigning anything to it a real type error, so a bare
// `defineSocket` ref truly exposes no usable `params` option. A `:param`
// binding still makes it required and typed from the route.
type ParamsOption<P> = keyof P extends never
  ? { params?: never }
  : { params: P };

export type UseSocketOptions<R extends AnySocketRefShape> = ParamsOption<
  ParamsOf<R>
> & {
  /** Called on every incoming message. Does NOT trigger a re-render. */
  onMessage?: (msg: Serialize<Outgoing<R>>) => void;
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
   * When false the socket will not connect (useful for conditional use).
   * Default: true.
   */
  enabled?: boolean;
  /**
   * When true, the most recent message is stored in reactive state and
   * returned as `lastMessage`. Off by default to avoid a re-render per
   * message.
   */
  lastMessage?: boolean;
};

export type UseSocketResult<R extends AnySocketRefShape> = {
  send: (msg: Incoming<R>) => void;
  status: SocketStatus;
  close: (code?: number, reason?: string) => void;
  closeInfo?: SocketCloseInfo;
  lastMessage?: Serialize<Outgoing<R>>;
};

// The options argument itself is required exactly when the route has params:
// a rest tuple, rather than a plain optional parameter, so `useSocket(ref)`
// with the options argument omitted ENTIRELY is a type error for a
// param-bearing binding (previously `opts` was merely optional, so omitting
// it compiled even when `ParamsOption` required `params`; the hole only bit
// once an options object was actually passed). Exported so `SocketRef.useSocket`
// in define-socket.ts spells the identical rest tuple instead of re-deriving it,
// keeping the free-function and ref-method arity rules single-sourced.
export type UseSocketArgs<R extends AnySocketRefShape> =
  keyof ParamsOf<R> extends never
    ? [opts?: UseSocketOptions<R>]
    : [opts: UseSocketOptions<R>];

export function useSocket<R extends AnySocketRefShape>(
  ref: R,
  ...args: UseSocketArgs<R>
): UseSocketResult<R> {
  const opts = args[0];
  const [lastMsg, setLastMsg] = useState<Serialize<Outgoing<R>> | undefined>(
    undefined
  );

  // Extract the ref fields at the top level so the effect dep array can
  // reference them.
  const moduleKey = ref[FORM_MODULE_FIELD];
  const socketName = ref[FORM_SOCKET_FIELD];

  const enabled = opts?.enabled ?? true;

  // JSON-encode route params (bound sockets) once per render so the dep array
  // stays a stable primitive. Read `opts?.params` DIRECTLY, with no cast: both
  // branches of `ParamsOption` declare a `params` property, so it is accessible
  // on the generic intersection. This mirrors use-room.ts, which reads
  // `opts?.key` off the identical `KeyOption` shape castless. A bare socket
  // types `params` as absent, so this is `undefined` there.
  const paramsJson = opts?.params ? JSON.stringify(opts.params) : undefined;

  const lifecycle = useWsLifecycle({
    enabled,
    ready: Boolean(moduleKey && socketName),
    deps: [moduleKey, socketName, paramsJson],
    buildUrl: () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const base = `${proto}//${location.host}${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent(moduleKey!)}&${SOCKET_NAME_PARAM}=${encodeURIComponent(socketName!)}`;
      return paramsJson !== undefined
        ? `${base}&${SOCKET_KEY_PARAM}=${encodeURIComponent(paramsJson)}`
        : base;
    },
    onOpen: () => opts?.onOpen?.(),
    onClose: (e) => opts?.onClose?.(e),
    shouldReconnect: opts?.shouldReconnect,
    reconnect: opts?.reconnect,
    onRawMessage: (raw) => {
      let parsed: Serialize<Outgoing<R>>;
      try {
        // Single sanctioned wire-boundary cast: JSON.parse returns unknown.
        parsed = JSON.parse(raw) as Serialize<Outgoing<R>>;
      } catch {
        return;
      }
      opts?.onMessage?.(parsed);
      if (opts?.lastMessage) {
        setLastMsg(parsed);
      }
    },
  });

  const sendRaw = lifecycle.sendRaw;
  const send = useCallback(
    (msg: Incoming<R>) => sendRaw(JSON.stringify(msg)),
    [sendRaw]
  );

  return {
    send,
    status: lifecycle.status,
    close: lifecycle.close,
    closeInfo: lifecycle.closeInfo,
    lastMessage: lastMsg,
  };
}
