import type { Context } from 'hono';
import type { VNode } from 'preact';
import { createDispatcher, HoofdProvider } from 'hoofd/preact';
import { prerender } from 'preact-iso/prerender';
import { GuardRedirect, env } from '@hono-preact/iso';
import { HonoRequestContext, runRequestScope, takeServerStreamingLoaders } from '@hono-preact/iso/internal';
import type { ServerLoaderStream } from '@hono-preact/iso/internal';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toAttrs(obj: Record<string, string | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`)
    .join(' ');
}

export async function renderPage(
  c: Context,
  node: VNode,
  options?: { defaultTitle?: string }
): Promise<Response> {
  const dispatcher = createDispatcher();
  const previousEnv = env.current;
  env.current = 'server';

  let html: string;
  let streamingLoaders: ServerLoaderStream[];
  try {
    const result = await runRequestScope(
      async () => {
        const rendered = await prerender(
          <HonoRequestContext.Provider value={{ context: c }}>
            <HoofdProvider value={dispatcher}>{node}</HoofdProvider>
          </HonoRequestContext.Provider>
        );
        const loaders = takeServerStreamingLoaders();
        return { html: rendered.html, streamingLoaders: loaders };
      },
      { honoContext: c }
    );
    html = result.html;
    streamingLoaders = result.streamingLoaders;
  } catch (e: unknown) {
    if (e instanceof GuardRedirect) return c.redirect(e.location);
    throw e;
  } finally {
    env.current = previousEnv;
  }

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
    ? (lang != null
        ? inner.replace(/<html(\s|>)/i, `<html lang="${escapeHtml(lang)}"$1`)
        : inner)
    : `<html lang="${escapeHtml(lang ?? 'en-US')}">\n${inner}\n</html>`;

  // Non-streaming case: preserve existing single-shot behavior.
  if (streamingLoaders.length === 0) {
    return c.html(`<!doctype html>${fullHtml}`);
  }

  // Streaming case: split at </body> so we can interleave per-loader chunk
  // script tags between the rendered body and the closing tags.
  const bodyCloseIdx = fullHtml.lastIndexOf('</body>');
  const beforeBody = bodyCloseIdx >= 0 ? fullHtml.slice(0, bodyCloseIdx) : fullHtml;
  const afterBody = bodyCloseIdx >= 0 ? fullHtml.slice(bodyCloseIdx) : '';

  // Inline bootstrap installs a queue on window.__HP_STREAM__ so that
  // events flushed BEFORE the client bundle loads are buffered. The
  // client entry calls installStreamRegistry() which drains the queue.
  // Each emitted script self-removes after running so the DOM doesn't
  // accumulate inert <script> nodes over the life of the page.
  const bootstrap =
    '<script>window.__HP_STREAM__=window.__HP_STREAM__||{queue:[],' +
    'push(id,v){this.queue.push({type:"push",loaderId:id,value:v})},' +
    'end(id){this.queue.push({type:"end",loaderId:id})},' +
    'error(id,e){this.queue.push({type:"error",loaderId:id,error:e})}};' +
    'document.currentScript.remove()</script>';

  const encoder = new TextEncoder();
  const requestSignal = c.req.raw.signal;

  const responseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`<!doctype html>${beforeBody}\n${bootstrap}\n`));

        // Drive each pending generator in parallel; emit script tags per chunk.
        await Promise.all(
          streamingLoaders.map(async ({ loaderId, gen }) => {
            try {
              while (true) {
                if (requestSignal.aborted) {
                  await gen.return(undefined).catch(() => { /* swallow */ });
                  return;
                }
                const step = await gen.next();
                if (step.done) {
                  controller.enqueue(
                    encoder.encode(
                      `<script>window.__HP_STREAM__.end(${JSON.stringify(loaderId)});document.currentScript.remove()</script>\n`
                    )
                  );
                  return;
                }
                controller.enqueue(
                  encoder.encode(
                    `<script>window.__HP_STREAM__.push(${JSON.stringify(loaderId)},${JSON.stringify(step.value)});document.currentScript.remove()</script>\n`
                  )
                );
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              const name = err instanceof Error ? err.name : 'Error';
              controller.enqueue(
                encoder.encode(
                  `<script>window.__HP_STREAM__.error(${JSON.stringify(loaderId)},${JSON.stringify({ message, name })});document.currentScript.remove()</script>\n`
                )
              );
            }
          })
        );

        controller.enqueue(encoder.encode(afterBody));
      } finally {
        controller.close();
      }
    },
    cancel() {
      for (const { gen } of streamingLoaders) {
        gen.return(undefined).catch(() => { /* swallow */ });
      }
    },
  });

  requestSignal.addEventListener('abort', () => {
    for (const { gen } of streamingLoaders) {
      gen.return(undefined).catch(() => { /* swallow */ });
    }
  });

  return new Response(responseStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}
