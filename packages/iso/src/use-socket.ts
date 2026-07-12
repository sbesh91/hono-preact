import { useCallback, useState } from 'preact/hooks';
import type { SocketRef } from './define-socket.js';
import type { Serialize } from './internal/serialize.js';
import {
  SOCKETS_RPC_PATH,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
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

// Extract the Incoming message type from a SocketRef.
type Incoming<R> = R extends SocketRef<infer I, unknown> ? I : never;
// Extract the Outgoing message type from a SocketRef (received by the client).
type Outgoing<R> = R extends SocketRef<unknown, infer O> ? O : never;

export type UseSocketOptions<R extends SocketRef<unknown, unknown, unknown>> = {
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

export type UseSocketResult<R extends SocketRef<unknown, unknown, unknown>> = {
  send: (msg: Incoming<R>) => void;
  status: SocketStatus;
  close: (code?: number, reason?: string) => void;
  closeInfo?: SocketCloseInfo;
  lastMessage?: Serialize<Outgoing<R>>;
};

export function useSocket<R extends SocketRef<unknown, unknown, unknown>>(
  ref: R,
  opts?: UseSocketOptions<R>
): UseSocketResult<R> {
  const [lastMsg, setLastMsg] = useState<Serialize<Outgoing<R>> | undefined>(
    undefined
  );

  // Extract the ref fields at the top level so the effect dep array can
  // reference them.
  const moduleKey = ref[FORM_MODULE_FIELD];
  const socketName = ref[FORM_SOCKET_FIELD];

  const enabled = opts?.enabled ?? true;

  const lifecycle = useWsLifecycle({
    enabled,
    ready: Boolean(moduleKey && socketName),
    deps: [moduleKey, socketName],
    buildUrl: () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${location.host}${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent(moduleKey!)}&${SOCKET_NAME_PARAM}=${encodeURIComponent(socketName!)}`;
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
