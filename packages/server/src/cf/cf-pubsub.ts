/// <reference types="@cloudflare/workers-types/latest" />
//
// The platform-free Cloudflare PubSubBackend: the worker side of DO-backed
// pub/sub for `live` loaders + cross-isolate publish(). Like realtime-do-glue.ts
// it uses @cloudflare/workers-types for TYPES only (erased at runtime) and
// imports NO `cloudflare:workers` runtime module, so it is unit-testable in
// plain vitest with a fake DurableObjectNamespace.

import type { PubSubBackend } from '@hono-preact/iso/internal/runtime';

/**
 * The per-request worker runtime the CF backend needs: the binding-carrying
 * `env` and the `ExecutionContext` (for waitUntil). The generated worker entry
 * captures this at the fetch boundary (captureRealtimeRuntime) on every request.
 */
export interface RealtimeRuntime {
  env: Record<string, unknown>;
  ctx: { waitUntil(promise: Promise<unknown>): void };
}

let captured: RealtimeRuntime | undefined;

/** Stash the request runtime so the CF backend can reach the DO binding. */
export function captureRealtimeRuntime(
  env: Record<string, unknown>,
  ctx: { waitUntil(promise: Promise<unknown>): void }
): void {
  captured = { env, ctx };
}

/** The latest captured runtime (undefined before the first request). */
export function getRealtimeRuntime(): RealtimeRuntime | undefined {
  return captured;
}

/** Test-only: clear the captured runtime between tests. */
export function __resetRealtimeRuntimeForTesting(): void {
  captured = undefined;
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
  function namespace(): DurableObjectNamespace {
    const rt = getRuntime();
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
      const rt = getRuntime();
      const ns = namespace();
      const stub = ns.get(ns.idFromName(topic));
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

    subscribe(topic, onMessage) {
      const ns = namespace();
      const stub = ns.get(ns.idFromName(topic));
      let socket: WebSocket | null = null;
      let closed = false;

      const opening = stub
        .fetch(SUBSCRIBE_URL, {
          headers: {
            Upgrade: 'websocket',
            'x-hp-kind': 'topic',
            'x-hp-topic': topic,
          },
        })
        .then(
          (res: Response) => {
            if (closed) return;
            const ws = res.webSocket;
            if (!ws) {
              throw new Error(
                'hono-preact: DO topic subscribe did not return a WebSocket'
              );
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
            socket = ws;
          },
          (err: unknown) => {
            console.error('hono-preact: pub/sub subscribe failed', err);
          }
        );

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
