import type { Context } from 'hono';
import type { VNode } from 'preact';
import { createDispatcher, HoofdProvider } from 'hoofd/preact';
import { prerender } from 'preact-iso/prerender';
import { GuardRedirect, env } from '@hono-preact/iso';
import { runRequestScope } from '@hono-preact/iso/internal';

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

// this is a bit too naive still
export async function renderPage(
  c: Context,
  node: VNode,
  options?: { defaultTitle?: string }
): Promise<Response> {
  const dispatcher = createDispatcher();

  const previousEnv = env.current;
  env.current = 'server';

  let html: string;
  try {
    ({ html } = await runRequestScope(() =>
      prerender(<HoofdProvider value={dispatcher}>{node}</HoofdProvider>)
    ));
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

  if (startsWithHtml) {
    const withLang =
      lang != null
        ? inner.replace(/<html(\s|>)/i, `<html lang="${escapeHtml(lang)}"$1`)
        : inner;
    return c.html(`<!doctype html>${withLang}`);
  }

  return c.html(
    `<!doctype html>
      <html lang="${escapeHtml(lang ?? 'en-US')}">
        ${inner}
      </html>`
  );
}
