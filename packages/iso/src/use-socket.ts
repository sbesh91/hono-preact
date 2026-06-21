import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { isBrowser } from './is-browser.js';
import type { SocketRef } from './define-socket.js';
import type { Serialize } from './internal/serialize.js';
import {
  SOCKETS_RPC_PATH,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  FORM_MODULE_FIELD,
  FORM_SOCKET_FIELD,
} from './internal/contract.js';

// Extract the Incoming message type from a SocketRef.
type Incoming<R> = R extends SocketRef<infer I, unknown> ? I : never;
// Extract the Outgoing message type from a SocketRef (received by the client).
type Outgoing<R> = R extends SocketRef<unknown, infer O> ? O : never;

export type SocketStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closing'
  | 'closed';

export type SocketCloseInfo = {
  code: number;
  reason: string;
  wasClean: boolean;
};

export type ReconnectOpts = {
  /** Maximum number of reconnect attempts. Default: 5. */
  maxRetries?: number;
  /** Minimum delay before first retry in ms. Default: 250. */
  minDelay?: number;
  /** Maximum backoff cap in ms. Default: 30000. */
  maxDelay?: number;
  /** Exponential growth factor. Default: 2. */
  growth?: number;
};

export type UseSocketOpts<R extends SocketRef<unknown, unknown>> = {
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
  reconnect?: ReconnectOpts;
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

export type UseSocketResult<R extends SocketRef<unknown, unknown>> = {
  send: (msg: Incoming<R>) => void;
  status: SocketStatus;
  close: (code?: number, reason?: string) => void;
  closeInfo?: SocketCloseInfo;
  lastMessage?: Serialize<Outgoing<R>>;
};

// Default shouldReconnect: false on normal closure (1000) and
// application-defined codes (4000-4999), true for everything else.
function defaultShouldReconnect(e: CloseEvent): boolean {
  if (e.code === 1000) return false;
  if (e.code >= 4000 && e.code <= 4999) return false;
  return true;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_MIN_DELAY = 250;
const DEFAULT_MAX_DELAY = 30_000;
const DEFAULT_GROWTH = 2;

// Maximum number of messages to buffer while the socket is not open.
const QUEUE_LIMIT = 128;

export function useSocket<R extends SocketRef<unknown, unknown>>(
  ref: R,
  opts?: UseSocketOpts<R>
): UseSocketResult<R> {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [closeInfo, setCloseInfo] = useState<SocketCloseInfo | undefined>(
    undefined
  );
  const [lastMsg, setLastMsg] = useState<Serialize<Outgoing<R>> | undefined>(
    undefined
  );

  // Stable ref so callbacks capture the latest opts without re-connecting.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Mutable state the effect manages.
  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<string[]>([]);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the user called close() explicitly so we suppress reconnect.
  const userClosedRef = useRef(false);

  // A stable send that queues while not open and flushes on connect.
  const send = useCallback((msg: Incoming<R>) => {
    const encoded = JSON.stringify(msg);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(encoded);
    } else {
      if (queueRef.current.length < QUEUE_LIMIT) {
        queueRef.current.push(encoded);
      }
    }
  }, []);

  // A stable close that marks the socket as user-closed.
  const close = useCallback((code?: number, reason?: string) => {
    userClosedRef.current = true;
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (socketRef.current) {
      setStatus('closing');
      socketRef.current.close(code, reason);
    } else {
      setStatus('closed');
    }
  }, []);

  // Extract the ref fields at the top level so the effect dep array can
  // reference them without declaring variables inside the effect body.
  const moduleKey = ref[FORM_MODULE_FIELD];
  const socketName = ref[FORM_SOCKET_FIELD];

  useEffect(() => {
    if (!isBrowser()) return;

    const enabled = optsRef.current?.enabled ?? true;
    if (!enabled) return;

    if (!moduleKey || !socketName) return;

    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent(moduleKey!)}&${SOCKET_NAME_PARAM}=${encodeURIComponent(socketName!)}`;

      setStatus('connecting');

      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        if (unmounted) {
          ws.close();
          return;
        }
        retryCountRef.current = 0;
        setStatus('open');
        optsRef.current?.onOpen?.();

        // Flush the send queue.
        const q = queueRef.current.splice(0);
        for (const encoded of q) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(encoded);
          }
        }
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (unmounted) return;
        let parsed: Serialize<Outgoing<R>>;
        try {
          // Single sanctioned wire-boundary cast: JSON.parse returns unknown.
          parsed = JSON.parse(ev.data as string) as Serialize<Outgoing<R>>;
        } catch {
          return;
        }
        optsRef.current?.onMessage?.(parsed);
        if (optsRef.current?.lastMessage) {
          setLastMsg(parsed);
        }
      };

      ws.onclose = (ev: CloseEvent) => {
        if (unmounted) return;
        const info: SocketCloseInfo = {
          code: ev.code,
          reason: ev.reason,
          wasClean: ev.wasClean,
        };
        setCloseInfo(info);

        if (userClosedRef.current) {
          setStatus('closed');
          optsRef.current?.onClose?.(ev);
          socketRef.current = null;
          return;
        }

        optsRef.current?.onClose?.(ev);

        const checker =
          optsRef.current?.shouldReconnect ?? defaultShouldReconnect;
        const reconnectOpts = optsRef.current?.reconnect ?? {};
        const maxRetries = reconnectOpts.maxRetries ?? DEFAULT_MAX_RETRIES;

        if (checker(ev) && retryCountRef.current < maxRetries) {
          const minDelay = reconnectOpts.minDelay ?? DEFAULT_MIN_DELAY;
          const maxDelay = reconnectOpts.maxDelay ?? DEFAULT_MAX_DELAY;
          const growth = reconnectOpts.growth ?? DEFAULT_GROWTH;
          const delay = Math.min(
            minDelay * Math.pow(growth, retryCountRef.current),
            maxDelay
          );
          retryCountRef.current += 1;
          setStatus('reconnecting');
          socketRef.current = null;
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            connect();
          }, delay);
        } else {
          setStatus('closed');
          socketRef.current = null;
        }
      };

      ws.onerror = () => {
        // onclose fires right after onerror for WebSocket; let it handle state.
      };
    }

    userClosedRef.current = false;
    connect();

    return () => {
      unmounted = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
    // Only reconnect when the ref identity (module+socket) changes or
    // enabled flips. opts changes are handled via optsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey, socketName, opts?.enabled]);

  return {
    send,
    status,
    close,
    closeInfo,
    ...(opts?.lastMessage ? { lastMessage: lastMsg } : {}),
  } as UseSocketResult<R>;
}
