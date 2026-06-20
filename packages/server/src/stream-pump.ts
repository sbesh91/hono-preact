import type { Context } from 'hono';
import type { ServerLoaderStream } from '@hono-preact/iso/internal';
import { warnMissingMarker } from './document-shell.js';

// ===========================================================================
// Streaming wire contract (producer half)
//
// These builders are the ONLY place the on-the-wire streaming event shape is
// authored on the server. The consumer half is the `StreamEvent` union and
// `installStreamRegistry()` in `@hono-preact/iso` (internal/stream-registry.ts).
// `__tests__/stream-wire-contract.test.ts` evaluates the bootstrap below and
// asserts the events it queues match that union, so a field/method rename on
// either side fails the build instead of silently desyncing.
// ===========================================================================

// JSON.stringify produces a string that is JS-evaluable but NOT safe to embed
// inside <script>...</script>: any '</script>' substring in the payload closes
// the script tag and turns the rest into HTML. Escaping '<' as < keeps the
// output valid JSON (so still parseable by the consumer) while preventing
// </script>, <!--, and <![CDATA[ from escaping the script context.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// The queue is capped at this many events. If the client bundle never loads
// (slow network, blocked CDN, ad-blocker on the script URL), a long-running
// streaming page would otherwise grow the buffer without bound. When the cap is
// hit, further events are dropped and `capped` is set so installStreamRegistry
// can warn. 1000 is far above realistic chunk counts (50-100/page is high).
export const HP_STREAM_QUEUE_CAP = 1000;

/**
 * The inline bootstrap that installs `window.__HP_STREAM__` with a capped queue
 * so events flushed BEFORE the client bundle loads are buffered; the client
 * entry's `installStreamRegistry()` drains the queue. Self-removes after
 * running so the DOM doesn't accumulate inert <script> nodes.
 */
export function streamBootstrapScript(
  cap: number = HP_STREAM_QUEUE_CAP
): string {
  return (
    `<script>window.__HP_STREAM__=window.__HP_STREAM__||{queue:[],capped:false,` +
    `_p(e){if(this.queue.length>=${cap}){this.capped=true;return}this.queue.push(e)},` +
    `push(id,v){this._p({type:"push",loaderId:id,value:v})},` +
    `end(id){this._p({type:"end",loaderId:id})},` +
    `error(id,e){this._p({type:"error",loaderId:id,error:e})}};` +
    `document.currentScript.remove()</script>`
  );
}

/** A per-chunk `push` event script tag (self-removing). */
export function pushScript(loaderId: string, value: unknown): string {
  return `<script>window.__HP_STREAM__.push(${jsonForScript(loaderId)},${jsonForScript(value)});document.currentScript.remove()</script>\n`;
}

/** A stream-`end` event script tag (self-removing). */
export function endScript(loaderId: string): string {
  return `<script>window.__HP_STREAM__.end(${jsonForScript(loaderId)});document.currentScript.remove()</script>\n`;
}

/** A stream-`error` event script tag (self-removing). */
export function errorScript(
  loaderId: string,
  error: { message: string; name: string }
): string {
  return `<script>window.__HP_STREAM__.error(${jsonForScript(loaderId)},${jsonForScript(error)});document.currentScript.remove()</script>\n`;
}

/**
 * Build the streaming HTML response: shell up to `</body>`, the bootstrap, then
 * per-loader chunk scripts interleaved as each generator yields, then the
 * closing tags. Multi-producer backpressure is enforced via a `TransformStream`
 * (each write awaits `writer.ready`), and the whole pump short-circuits on abort
 * (consumer cancel or request-signal abort).
 *
 * Extracted from `renderPage` so the pump is unit-testable in isolation and the
 * ~10 abort-guarded writes collapse to a single `guardedWrite` helper.
 */
export function streamDocumentResponse(
  c: Context,
  opts: {
    fullHtml: string;
    streamingLoaders: ServerLoaderStream[];
    requestSignal: AbortSignal;
    bindRequestScope: <R>(fn: () => R | Promise<R>) => R | Promise<R>;
  }
): Response {
  const { fullHtml, streamingLoaders, requestSignal, bindRequestScope } = opts;

  // Split at </body> so we can interleave per-loader chunk script tags between
  // the rendered body and the closing tags. A streaming page with no </body>
  // means the Layout didn't emit one; the scripts then land after the whole
  // document (still functional, but the marker is part of the contract).
  const bodyCloseIdx = fullHtml.lastIndexOf('</body>');
  if (bodyCloseIdx < 0) {
    warnMissingMarker(
      '</body>',
      'a streaming page emitted no </body>; per-chunk scripts are appended ' +
        'after the document instead of before the closing tags'
    );
  }
  const beforeBody =
    bodyCloseIdx >= 0 ? fullHtml.slice(0, bodyCloseIdx) : fullHtml;
  const afterBody = bodyCloseIdx >= 0 ? fullHtml.slice(bodyCloseIdx) : '';

  const encoder = new TextEncoder();

  // Tracks whether the consumer (Hono/runtime) has cancelled or the request
  // signal has aborted. Every controller op short-circuits when this is true so
  // we do not enqueue or close on an already-terminated controller.
  let aborted = false;

  // Multi-producer backpressure via TransformStream. Each loader pump writes to
  // the shared `writer`, awaiting `writer.ready` before each write so iteration
  // is paced by the consumer's read rate (not by how fast the generator yields).
  const { writable, readable: responseStream } = new TransformStream<
    Uint8Array,
    Uint8Array
  >();
  const writer = writable.getWriter();

  // The single abort-guarded write: bail (returning false) if aborted before or
  // after awaiting backpressure; otherwise write and return true. Replaces the
  // repeated `if (aborted) return; await writer.ready; if (aborted) return;`.
  const guardedWrite = async (bytes: Uint8Array): Promise<boolean> => {
    if (aborted) return false;
    await writer.ready;
    if (aborted) return false;
    await writer.write(bytes);
    return true;
  };

  // When the consumer cancels the readable side (Hono drops the response, or the
  // runtime tears down the request), the writable side errors and
  // `writer.closed` rejects. Propagate to the loader generators symmetrically
  // with the request-signal abort path below. The `aborted` guard makes the
  // self-triggered case (`writer.abort()` in our own finally) a no-op.
  writer.closed.catch(() => {
    if (aborted) return;
    aborted = true;
    for (const { gen } of streamingLoaders) {
      gen.return(undefined).catch(() => {
        /* swallow */
      });
    }
  });

  // Re-enter the captured request scope so generator continuations and anything
  // they touch (getRequestHonoContext, per-request loader caches) see the same
  // per-request store the initial prerender saw.
  void bindRequestScope(async () => {
    // Yield one microtask first. `renderPage` is still on the synchronous frame
    // that constructs this response (the TransformStream is created, then
    // `c.body(...)` commits headers). Resuming a generator can `setCookie`,
    // which mutates Hono's prepared headers; deferring guarantees the response
    // is built first so post-first-yield header writes are consistently
    // excluded rather than racing construction.
    await Promise.resolve();

    try {
      if (
        !(await guardedWrite(
          encoder.encode(
            `<!doctype html>${beforeBody}\n${streamBootstrapScript()}\n`
          )
        ))
      ) {
        return;
      }

      // Drive each pending generator in parallel; emit script tags per chunk.
      await Promise.all(
        streamingLoaders.map(async ({ loaderId, gen }) => {
          try {
            while (!aborted) {
              const step = await gen.next();
              if (aborted) return;
              if (step.done) {
                await guardedWrite(encoder.encode(endScript(loaderId)));
                return;
              }
              if (
                !(await guardedWrite(
                  encoder.encode(pushScript(loaderId, step.value))
                ))
              ) {
                return;
              }
            }
          } catch (err) {
            if (aborted) return;
            const message = err instanceof Error ? err.message : String(err);
            const name = err instanceof Error ? err.name : 'Error';
            try {
              await guardedWrite(
                encoder.encode(errorScript(loaderId, { message, name }))
              );
            } catch {
              /* swallow: writable side closed/errored */
            }
          }
        })
      );

      await guardedWrite(encoder.encode(afterBody));
    } catch {
      /* swallow: writable side closed/errored mid-pump */
    } finally {
      if (aborted) {
        writer.abort().catch(() => {
          /* swallow */
        });
      } else {
        writer.close().catch(() => {
          /* swallow */
        });
      }
    }
  });

  requestSignal.addEventListener('abort', () => {
    aborted = true;
    for (const { gen } of streamingLoaders) {
      gen.return(undefined).catch(() => {
        /* swallow */
      });
    }
    writer.abort().catch(() => {
      /* swallow */
    });
  });

  // Route through `c.body()` rather than `new Response(...)` so Hono merges its
  // prepared headers into the streamed response. A streaming loader's body runs
  // up to its first `yield` during prerender, so a `Set-Cookie` written via
  // `ctx.c` before that yield is sitting in Hono's prepared headers by now;
  // constructing the Response directly would drop it. Cookies written after a
  // yield run in the pump above, once headers are already sent, and are lost.
  return c.body(responseStream, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    // Prevent buffering / transformation by intermediate proxies. nginx honors
    // `X-Accel-Buffering: no` to flush per chunk; `no-transform` stops
    // middleboxes from rebuffering or gzipping the stream as a single response.
    // We deliberately do NOT add `no-store`: streamed HTML can still be
    // legitimately cacheable, and users can override via their own middleware.
    'X-Accel-Buffering': 'no',
    'Cache-Control': 'no-transform',
  });
}
