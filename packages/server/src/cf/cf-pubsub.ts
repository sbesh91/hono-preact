/// <reference types="@cloudflare/workers-types/latest" />
//
// The platform-free Cloudflare PubSubBackend: the worker side of DO-backed
// pub/sub for `live` loaders + cross-isolate publish(). Like realtime-do-glue.ts
// it uses @cloudflare/workers-types for TYPES only (erased at runtime) and
// imports NO `cloudflare:workers` runtime module, so it is unit-testable in
// plain vitest with a fake DurableObjectNamespace.

// AsyncLocalStorage is typed by the local ambient declaration in
// `node-async-hooks.d.ts` (a minimal one-export shim), NOT @types/node: this file
// relies on @cloudflare/workers-types and DOM globals (WebSocket, MessageEvent),
// so pulling global @types/node in would duplicate those and break door
// isolation. The runtime module is provided by nodejs_compat on workerd and
// natively on Node.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PubSubBackend } from '@hono-preact/iso/internal/runtime';
import { TOPIC_DO_PREFIX } from './realtime-do-glue.js';

/**
 * The per-request worker runtime the CF backend needs: the binding-carrying
 * `env` and the `ExecutionContext` (for waitUntil). The generated worker entry
 * runs each request inside this context (runWithRealtimeRuntime), so a deep
 * `publish()` reaches its OWN request's runtime.
 */
export interface RealtimeRuntime {
  env: Record<string, unknown>;
  ctx: { waitUntil(promise: Promise<unknown>): void };
}

// AsyncLocalStorage, NOT a module-scoped variable: a single Cloudflare isolate
// multiplexes concurrent in-flight requests, so a module global would be
// overwritten by a later request between an earlier request's capture and its
// publish() (binding the fan-out to the wrong ctx.waitUntil and silently
// dropping publishes under load). ALS scopes the runtime to each request's async
// context. nodejs_compat (already required for the realtime path) provides
// node:async_hooks on workerd.
const runtimeStore = new AsyncLocalStorage<RealtimeRuntime>();

/**
 * Run `fn` with the request runtime bound to the current async context. The
 * generated worker entry wraps `coreApp.fetch` in this, so every `publish()`
 * reached during the request (even after awaits) reads that request's own
 * `{ env, ctx }`.
 */
export function runWithRealtimeRuntime<T>(
  env: Record<string, unknown>,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  fn: () => T
): T {
  return runtimeStore.run({ env, ctx }, fn);
}

/** The current request's runtime (undefined outside a request scope). */
export function getRealtimeRuntime(): RealtimeRuntime | undefined {
  return runtimeStore.getStore();
}

// The DO publish/subscribe request URLs + the discriminator header. Kept in
// sync with the DO fetch branch in realtime-do.ts. The host is irrelevant (the
// stub routes by id, not URL), so a fixed placeholder origin is used.
const PUBLISH_URL = 'https://do/__hp_publish';
const SUBSCRIBE_URL = 'https://do/__hp_sub';

/**
 * Build the Cloudflare DO-backed PubSubBackend.
 *
 *  - subscribe(topic): opens a worker->DO WebSocket to idFromName(topic) in
 *    `x-hp-kind: topic` mode; each DO frame is parsed and handed to onMessage.
 *    The returned unsubscribe closes the socket (even mid-open).
 *  - publish(topic, msg): POSTs the message to idFromName(topic) in
 *    `x-hp-kind: publish` mode; the DO fans it out to its topic subscribers.
 *    Held with ctx.waitUntil so it survives the action response returning.
 *
 * A missing runtime or binding throws the same setup error the room connector
 * uses, naming the configured binding.
 */
export function makeCfPubSubBackend(
  getRuntime: () => RealtimeRuntime | undefined,
  realtimeBinding = 'HONO_PREACT_REALTIME'
): PubSubBackend {
  function resolveNamespace(
    rt: RealtimeRuntime | undefined
  ): DurableObjectNamespace {
    // Sanctioned env-binding read: bindings live on the untyped worker env, the
    // same boundary makeCfForwardConnector reads (c.env[binding]).
    const ns = rt?.env[realtimeBinding] as DurableObjectNamespace | undefined;
    if (!ns) {
      throw new Error(
        `hono-preact: live data and rooms on Cloudflare require the ${realtimeBinding} ` +
          'Durable Object binding. Add it to wrangler.jsonc (see the rooms docs).'
      );
    }
    return ns;
  }

  return {
    publish(topic, message) {
      // One getRuntime() read: env (for the binding) and ctx (for waitUntil)
      // must come from the SAME request runtime.
      const rt = getRuntime();
      const ns = resolveNamespace(rt);
      const stub = ns.get(ns.idFromName(TOPIC_DO_PREFIX + topic));
      const done = stub
        .fetch(PUBLISH_URL, {
          method: 'POST',
          headers: { 'x-hp-kind': 'publish' },
          body: JSON.stringify(message),
        })
        .then(
          () => undefined,
          (err: unknown) => {
            console.error('hono-preact: pub/sub publish failed', err);
          }
        );
      // Keep the fan-out alive after the action response returns.
      rt?.ctx.waitUntil(done);
    },

    subscribe(topic, onMessage, onError) {
      const ns = resolveNamespace(getRuntime());
      const stub = ns.get(ns.idFromName(TOPIC_DO_PREFIX + topic));
      let socket: WebSocket | null = null;
      let closed = false;

      // Report an unexpected drop exactly once, and never for a close WE
      // initiated (unsub). Surfacing it lets the live-loader generator error
      // rather than hang on stale data.
      const fail = (error: unknown) => {
        if (closed) return;
        closed = true;
        socket = null;
        onError?.(error);
      };

      const opening = stub
        .fetch(SUBSCRIBE_URL, {
          headers: {
            Upgrade: 'websocket',
            'x-hp-kind': 'topic',
            'x-hp-topic': topic,
          },
        })
        // .then(onFulfilled).catch(...), NOT the two-argument .then(ok, fail)
        // form: a synchronous throw inside onFulfilled (no webSocket, or accept()
        // throwing) rejects THIS promise, and only a trailing .catch folds those
        // in alongside an upstream stub.fetch rejection.
        .then((res: Response) => {
          const ws = res.webSocket;
          if (!ws) {
            throw new Error(
              'hono-preact: DO topic subscribe did not return a WebSocket'
            );
          }
          if (closed) {
            // unsub ran before the upgrade resolved. The DO already accepted the
            // server end for hibernation (synchronously, before returning the
            // 101), so close this end to evict it instead of leaking it into the
            // topic's getWebSockets('topic') set.
            try {
              ws.close();
            } catch {
              // already closing/closed
            }
            return;
          }
          ws.accept();
          ws.addEventListener('message', (ev: MessageEvent) => {
            try {
              onMessage(
                typeof ev.data === 'string' ? JSON.parse(ev.data) : null
              );
            } catch {
              // A malformed DO frame is dropped (the live-loader wake path
              // ignores the payload anyway; a re-run reads fresh state).
              onMessage(null);
            }
          });
          // A worker->DO topic socket can die mid-life (DO eviction on deploy or
          // migration, a transient blip). Surface it rather than going stale.
          ws.addEventListener('close', () =>
            fail(new Error('hono-preact: live subscription socket closed'))
          );
          ws.addEventListener('error', () =>
            fail(new Error('hono-preact: live subscription socket errored'))
          );
          socket = ws;
        })
        .catch((err: unknown) => {
          // Open-time failure (DO unreachable, no webSocket, accept() throwing).
          // If we already tore down, just log; otherwise surface it.
          if (closed) {
            console.error('hono-preact: pub/sub subscribe failed', err);
            return;
          }
          fail(err);
        });

      return () => {
        closed = true;
        void opening.then(() => {
          socket?.close();
          socket = null;
        });
      };
    },
  };
}
