import type { Context } from 'hono';
import type { VNode } from 'preact';
import { createDispatcher, HoofdProvider } from 'hoofd/preact';
import { prerender } from 'preact-iso/prerender';
import { GuardRedirect, env } from '@hono-preact/iso';
import { runRequestScope, FragmentModeContext } from '@hono-preact/iso/internal';

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
  const isFragment = c.req.header('X-HP-Navigate') === 'fragment';
  if (isFragment) return renderFragment(c, node);
  return renderDocument(c, node, options);
}

const FRAGMENT_OPEN = '<hp-page-fragment>';
const FRAGMENT_CLOSE = '</hp-page-fragment>';

async function renderFragment(c: Context, node: VNode): Promise<Response> {
  const dispatcher = createDispatcher();
  const previousEnv = env.current;
  env.current = 'server';

  let html: string;
  try {
    ({ html } = await runRequestScope(() =>
      prerender(
        <FragmentModeContext.Provider value={true}>
          <HoofdProvider value={dispatcher}>{node}</HoofdProvider>
        </FragmentModeContext.Provider>
      )
    ));
  } catch (e: unknown) {
    if (e instanceof GuardRedirect) {
      return c.json({
        events: [{ type: 'redirect', location: e.location }],
      });
    }
    throw e;
  } finally {
    env.current = previousEnv;
  }

  const start = html.indexOf(FRAGMENT_OPEN);
  const end = html.indexOf(FRAGMENT_CLOSE);
  if (start < 0 || end < 0 || end < start) {
    // No fragment marker found. Either the matched route did not render <Page>,
    // or the marker was stripped. Fall back to instructing the client to do a
    // hard navigation.
    return c.json({ events: [{ type: 'fallback' }] }, 200);
  }
  const captured = html.slice(start + FRAGMENT_OPEN.length, end);

  const { title } = dispatcher.toStatic();
  return c.json({
    events: [
      {
        type: 'envelope',
        html: captured,
        head: { title },
      },
    ],
  });
}

async function renderDocument(
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
