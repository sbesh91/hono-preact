import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';

/**
 * Shared raw-WebSocket lifecycle for `useSocket` and `useRoom`.
 *
 * This owns the transport concerns both hooks share: the connection, the
 * status machine, finite exponential-backoff reconnect, a send queue that
 * buffers while not open and flushes on connect, the SSR guard, and cleanup.
 * It is deliberately thin: it knows nothing about message SHAPE. Envelope
 * decoding, presence routing, and the per-hook message callback live in the
 * consuming hook, which receives each raw string via `onRawMessage` and sends
 * already-encoded strings via the returned `send`.
 */

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

/**
 * The per-hook behavior the lifecycle calls into. `buildUrl` is recomputed on
 * each (re)connect; the callbacks let the consuming hook react to lifecycle
 * events without owning the transport.
 */
export type WsLifecycleConfig = {
  /** Build the connection URL (recomputed on every connect attempt). */
  buildUrl: () => string;
  /** True when the connection should not be opened at all. */
  enabled: boolean;
  /** True when required selectors are missing; skips connecting. */
  ready: boolean;
  /** Re-run when these change to force a reconnect. opts ride a stable ref. */
  deps: ReadonlyArray<unknown>;
  /** Called once the socket opens (after the send queue flushes). */
  onOpen?: () => void;
  /** Called for each raw incoming message string. */
  onRawMessage?: (raw: string) => void;
  /** Called on every close event (before reconnect is decided). */
  onClose?: (e: CloseEvent) => void;
  /** Predicate controlling whether to reconnect after a close. */
  shouldReconnect?: (e: CloseEvent) => boolean;
  /** Reconnect backoff tuning. */
  reconnect?: ReconnectOpts;
};

export type WsLifecycle = {
  /** Send an already-encoded string; queues while not open, flushes on open. */
  sendRaw: (encoded: string) => void;
  /** Close the socket and suppress reconnect. */
  close: (code?: number, reason?: string) => void;
  status: SocketStatus;
  closeInfo?: SocketCloseInfo;
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

/**
 * Drive a single raw WebSocket through its lifecycle. `config` is read through
 * a stable ref so callback changes never reconnect; only `config.deps` (the
 * connection identity) and `enabled`/`ready` drive reconnects.
 */
export function useWsLifecycle(config: WsLifecycleConfig): WsLifecycle {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [closeInfo, setCloseInfo] = useState<SocketCloseInfo | undefined>(
    undefined
  );

  // Stable ref so callbacks capture the latest config without re-connecting.
  const configRef = useRef(config);
  configRef.current = config;

  // Mutable state the effect manages.
  const socketRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<string[]>([]);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the user called close() explicitly so we suppress reconnect.
  const userClosedRef = useRef(false);

  // A stable send that queues while not open and flushes on connect.
  const sendRaw = useCallback((encoded: string) => {
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

  const { enabled, ready } = config;

  useEffect(() => {
    if (!isBrowser()) return;
    if (!enabled) return;
    if (!ready) return;

    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const url = configRef.current.buildUrl();

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
        configRef.current.onOpen?.();

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
        configRef.current.onRawMessage?.(ev.data);
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
          configRef.current.onClose?.(ev);
          socketRef.current = null;
          return;
        }

        configRef.current.onClose?.(ev);

        const checker =
          configRef.current.shouldReconnect ?? defaultShouldReconnect;
        const reconnectOpts = configRef.current.reconnect ?? {};
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
    // Only reconnect when the connection identity (deps) or enabled/ready
    // change. Callback/config changes are handled via configRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, ...config.deps]);

  return { sendRaw, close, status, closeInfo };
}
