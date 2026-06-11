import type { Context } from 'hono';
import type { VNode } from 'preact';
import { createDispatcher, HoofdProvider } from 'hoofd/preact';
import { prerender, locationStub } from 'preact-iso/prerender';
import {
  env,
  isOutcome,
  type AppConfig,
  type Middleware,
  type Outcome,
  type ServerMiddleware,
  type ServerPageCtx,
  ActionResultContext,
  type ActionResultContextValue,
} from '@hono-preact/iso';
import {
  HonoRequestContext,
  runRequestScope,
  captureRequestScope,
  takeServerStreamingLoaders,
  dispatchServer,
  partitionUse,
  getActionResultSlot,
} from '@hono-preact/iso/internal';
import type { ServerLoaderStream } from '@hono-preact/iso/internal';
import { speculationRulesTag } from './speculation-rules.js';
import { translateRootOutcome } from './outcome-translation.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// JSON.stringify produces a string that is JS-evaluable but NOT safe to embed
// inside <script>...</script>: any '</script>' substring in the payload closes
// the script tag and turns the rest into HTML. Escaping '<' as < keeps the
// output valid JSON (and so still parseable by the consumer) while preventing
// </script>, <!--, and <![CDATA[ from escaping the script context.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function toAttrs(obj: Record<string, string | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`)
    .join(' ');
}

function buildActionResultContext(): ActionResultContextValue {
  const slot = getActionResultSlot();
  if (!slot) return null;
  if (slot.resolution.kind === 'success') {
    return {
      module: slot.module,
      action: slot.action,
      kind: 'success',
      data: slot.resolution.data,
      submittedPayload: slot.submittedPayload,
    };
  }
  if (slot.resolution.kind === 'error') {
    return {
      module: slot.module,
      action: slot.action,
      kind: 'error',
      message: slot.resolution.message,
      submittedPayload: slot.submittedPayload,
    };
  }
  const { outcome } = slot.resolution;
  if (outcome.__outcome === 'deny') {
    return {
      module: slot.module,
      action: slot.action,
      kind: 'deny',
      status: outcome.status,
      message: outcome.message,
      data: outcome.data,
      submittedPayload: slot.submittedPayload,
    };
  }
  return null;
}

export async function renderPage(
  c: Context,
  node: VNode,
  options?: { defaultTitle?: string; appConfig?: AppConfig }
): Promise<Response> {
  const dispatcher = createDispatcher();
  const previousEnv = env.current;
  env.current = 'server';

  let html: string;
  let streamingLoaders: ServerLoaderStream[];
  // Binder that re-enters the per-request ALS store; populated inside the
  // scope below. Streaming loaders that yield, then resume from outside
  // `runRequestScope` (the ReadableStream.start callback runs after this
  // frame returns) lose ALS propagation on V8. Wrapping the drain in this
  // binder restores per-request isolation for `getRequestStore` /
  // `getRequestHonoContext` reads from generator continuations.
  let bindRequestScope: <R>(fn: () => R | Promise<R>) => R | Promise<R> = (
    fn
  ) => fn();

  // Sentinel returned by the root chain when middleware short-circuits with
  // a redirect or deny outcome. We translate to a Response outside the scope
  // (after env.current restoration) so the abort-before-render path stays
  // symmetric with the regular outcome path.
  type RootOutcome = { kind: 'outcome'; outcome: Outcome };
  type RootValue = {
    kind: 'value';
    html: string;
    streamingLoaders: ServerLoaderStream[];
  };
  let rootResult: RootOutcome | RootValue;
  try {
    rootResult = await runRequestScope(
      async (): Promise<RootOutcome | RootValue> => {
        const reqUrl = new URL(c.req.url);
        const location = {
          path: reqUrl.pathname,
          searchParams: Object.fromEntries(reqUrl.searchParams),
          // Path params are route-match output; the root layer runs before
          // route matching, so they're empty here. Page-layer middleware
          // (added in a follow-up) will have them populated.
          pathParams: {},
        };

        const rootUse = options?.appConfig?.use ?? [];
        const serverMw = partitionUse(
          rootUse as ReadonlyArray<Middleware>
        ).middleware.filter(
          (m): m is ServerMiddleware<'page'> => m.runs === 'server'
        );

        const ctx: ServerPageCtx = {
          scope: 'page',
          c,
          signal: c.req.raw.signal,
          location,
        };

        const dispatch = await dispatchServer<RootValue, 'page'>({
          middleware: serverMw,
          ctx,
          inner: async (): Promise<RootValue> => {
            // preact-iso's `LocationProvider` reads `globalThis.location`
            // once, synchronously, when it mounts. Set it on the same
            // microtask as the `prerender` call so no other request can
            // interleave and trample the global between us writing it and
            // the provider reading it. Children resume from reducer state,
            // never re-reading the global, so the rest of this render is
            // safe even if another request resets `globalThis.location`
            // while we await suspended children.
            locationStub(reqUrl.pathname + reqUrl.search);
            bindRequestScope = captureRequestScope();
            const rendered = await prerender(
              <ActionResultContext.Provider value={buildActionResultContext()}>
                <HonoRequestContext.Provider value={{ context: c }}>
                  <HoofdProvider value={dispatcher}>{node}</HoofdProvider>
                </HonoRequestContext.Provider>
              </ActionResultContext.Provider>
            );
            const loaders = takeServerStreamingLoaders();
            return {
              kind: 'value',
              html: rendered.html,
              streamingLoaders: loaders,
            };
          },
        });

        if (dispatch.kind === 'outcome') {
          return { kind: 'outcome', outcome: dispatch.outcome };
        }
        return dispatch.value;
      },
      { honoContext: c }
    );
  } catch (e: unknown) {
    if (isOutcome(e)) return translateRootOutcome(c, e);
    throw e;
  } finally {
    env.current = previousEnv;
  }

  if (rootResult.kind === 'outcome') {
    return translateRootOutcome(c, rootResult.outcome);
  }
  html = rootResult.html;
  streamingLoaders = rootResult.streamingLoaders;

  const { title, lang, metas = [], links = [] } = dispatcher.toStatic();

  // Only inject a <title> when hoofd produced one or the caller provided a
  // defaultTitle. Layouts that render their own static <title> (via <Head>)
  // would otherwise be overridden by an empty injected one (browsers use
  // the last <title> in <head>).
  const titleSource = title ?? options?.defaultTitle;
  const headTags = [
    titleSource != null ? `<title>${escapeHtml(titleSource)}</title>` : '',
    ...metas.map((m) => `<meta ${toAttrs(m)} />`),
    ...links.map((l) => `<link ${toAttrs(l)} />`),
    speculationRulesTag(options?.appConfig ?? {}),
  ]
    .filter(Boolean)
    .join('\n        ');

  const inner = html.replace('</head>', `${headTags}\n      </head>`);

  // If the rendered tree already starts with <html>, the user's Layout owns
  // the document shell. Inject hoofd's lang into that <html> tag (if hoofd
  // dispatched one) and emit only the doctype; do not double-wrap.
  // Otherwise (custom server entry rendering a fragment) keep the framework's
  // <html lang> wrapper for backward compatibility.
  const startsWithHtml = /^\s*<html(\s|>)/i.test(inner);

  const fullHtml = startsWithHtml
    ? lang != null
      ? inner.replace(/<html(\s|>)/i, `<html lang="${escapeHtml(lang)}"$1`)
      : inner
    : `<html lang="${escapeHtml(lang ?? 'en-US')}">\n${inner}\n</html>`;

  // Non-streaming case: preserve existing single-shot behavior.
  if (streamingLoaders.length === 0) {
    return c.html(`<!doctype html>${fullHtml}`);
  }

  // Streaming case: split at </body> so we can interleave per-loader chunk
  // script tags between the rendered body and the closing tags.
  const bodyCloseIdx = fullHtml.lastIndexOf('</body>');
  const beforeBody =
    bodyCloseIdx >= 0 ? fullHtml.slice(0, bodyCloseIdx) : fullHtml;
  const afterBody = bodyCloseIdx >= 0 ? fullHtml.slice(bodyCloseIdx) : '';

  // Inline bootstrap installs a queue on window.__HP_STREAM__ so that
  // events flushed BEFORE the client bundle loads are buffered. The
  // client entry calls installStreamRegistry() which drains the queue.
  // Each emitted script self-removes after running so the DOM doesn't
  // accumulate inert <script> nodes over the life of the page.
  //
  // The queue is capped at HP_STREAM_QUEUE_CAP events. If the client bundle
  // never loads (slow network, blocked CDN, ad-blocker on the script URL),
  // a long-running streaming page would otherwise grow this buffer without
  // bound. When the cap is hit, additional events are silently dropped and
  // `capped` is set so installStreamRegistry can see lossage occurred.
  // Picked 1000 so realistic apps (50-100 chunks per page is high) never
  // hit it; pathological cases trade data loss for bounded memory.
  const HP_STREAM_QUEUE_CAP = 1000;
  const bootstrap =
    `<script>window.__HP_STREAM__=window.__HP_STREAM__||{queue:[],capped:false,` +
    `_p(e){if(this.queue.length>=${HP_STREAM_QUEUE_CAP}){this.capped=true;return}this.queue.push(e)},` +
    `push(id,v){this._p({type:"push",loaderId:id,value:v})},` +
    `end(id){this._p({type:"end",loaderId:id})},` +
    `error(id,e){this._p({type:"error",loaderId:id,error:e})}};` +
    `document.currentScript.remove()</script>`;

  const encoder = new TextEncoder();
  const requestSignal = c.req.raw.signal;

  // Tracks whether the consumer (Hono/runtime) has cancelled or the request
  // signal has aborted. Set by `cancel()` and by the abort listener below.
  // Every controller op in the pump short-circuits when this is true so we
  // do not enqueue or close on an already-terminated controller (which would
  // throw and, for the per-loader catch, get logged as a synthetic error
  // chunk that nobody can read anyway).
  let aborted = false;

  // Multi-producer backpressure via TransformStream. Each loader pump writes
  // to a shared `writer`, awaiting `writer.ready` before each write so that
  // the per-loader iteration is paced by the consumer's read rate (not by
  // however fast the generator yields). Without this, a tight-loop streaming
  // loader would buffer chunks into the ReadableStream queue unbounded; see
  // render-stream.test.tsx "pauses production when the HTML consumer is
  // slow (backpressure)".
  const { writable, readable: responseStream } = new TransformStream<
    Uint8Array,
    Uint8Array
  >();
  const writer = writable.getWriter();

  // When the consumer cancels the readable side (e.g. Hono drops the response,
  // or the runtime tears down the request), the writable side transitions to
  // an errored state and `writer.closed` rejects. Propagate to the loader
  // generators symmetrically with the request-signal abort path below. The
  // `aborted` guard makes the self-triggered case (`writer.abort()` in our
  // own finally) a no-op.
  writer.closed.catch(() => {
    if (aborted) return;
    aborted = true;
    for (const { gen } of streamingLoaders) {
      gen.return(undefined).catch(() => {
        /* swallow */
      });
    }
  });

  // Re-enter the captured request scope so generator continuations and
  // anything they touch (e.g. `getRequestHonoContext`, per-request loader
  // caches) see the same per-request store the initial prerender saw.
  void bindRequestScope(async () => {
    // Yield one microtask before doing anything else. `renderPage` is still
    // on the synchronous frame that constructs this response (TransformStream
    // is created, then `c.body(...)` runs and commits the headers). Resuming
    // a generator can call `setCookie(ctx.c, ...)`, which mutates Hono's
    // prepared headers; deferring the pump guarantees the response is built
    // first, so post-first-yield header writes are consistently excluded
    // rather than racing construction. Cookies must be set before the
    // loader's first yield to reach the streamed response.
    await Promise.resolve();

    try {
      if (aborted) return;
      await writer.ready;
      if (aborted) return;
      await writer.write(
        encoder.encode(`<!doctype html>${beforeBody}\n${bootstrap}\n`)
      );

      // Drive each pending generator in parallel; emit script tags per chunk.
      await Promise.all(
        streamingLoaders.map(async ({ loaderId, gen }) => {
          try {
            while (!aborted) {
              const step = await gen.next();
              if (aborted) return;
              await writer.ready;
              if (aborted) return;
              if (step.done) {
                await writer.write(
                  encoder.encode(
                    `<script>window.__HP_STREAM__.end(${jsonForScript(loaderId)});document.currentScript.remove()</script>\n`
                  )
                );
                return;
              }
              await writer.write(
                encoder.encode(
                  `<script>window.__HP_STREAM__.push(${jsonForScript(loaderId)},${jsonForScript(step.value)});document.currentScript.remove()</script>\n`
                )
              );
            }
          } catch (err) {
            if (aborted) return;
            const message = err instanceof Error ? err.message : String(err);
            const name = err instanceof Error ? err.name : 'Error';
            try {
              await writer.ready;
              if (aborted) return;
              await writer.write(
                encoder.encode(
                  `<script>window.__HP_STREAM__.error(${jsonForScript(loaderId)},${jsonForScript({ message, name })});document.currentScript.remove()</script>\n`
                )
              );
            } catch {
              /* swallow: writable side closed/errored */
            }
          }
        })
      );

      if (!aborted) {
        await writer.ready;
        if (!aborted) await writer.write(encoder.encode(afterBody));
      }
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

  // Route through `c.body()` rather than `new Response(...)` so Hono merges
  // its prepared headers into the streamed response. A streaming loader's
  // body runs up to its first `yield` during prerender, so a `Set-Cookie`
  // written via `ctx.c` before that yield is sitting in Hono's prepared
  // headers by now; constructing the Response directly would drop it. The
  // non-streaming branch above gets this for free via `c.html()`. Cookies
  // written after a yield run in the pump below, once headers are already
  // sent, and are unavoidably lost.
  return c.body(responseStream, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    // Prevent buffering / transformation by intermediate proxies. nginx
    // honors `X-Accel-Buffering: no` to flush per chunk; `no-transform`
    // stops middleboxes from rebuffering or gzipping the stream as a
    // single response. We deliberately do NOT add `no-store`: streamed
    // HTML can still be legitimately cacheable, and users can override
    // via their own middleware.
    'X-Accel-Buffering': 'no',
    'Cache-Control': 'no-transform',
  });
}
