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

  const headTags = [
    `<title>${escapeHtml(title ?? options?.defaultTitle ?? '')}</title>`,
    ...metas.map((m) => `<meta ${toAttrs(m)} />`),
    ...links.map((l) => `<link ${toAttrs(l)} />`),
  ].join('\n        ');

  return c.html(
    `<!doctype html>
      <html lang="${escapeHtml(lang ?? 'en-US')}">
        ${html.replace('</head>', `${headTags}\n      </head>`)}
      </html>`
  );
}
