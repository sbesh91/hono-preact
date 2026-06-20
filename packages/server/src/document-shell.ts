import type { AppConfig } from '@hono-preact/iso';
import { speculationRulesTag } from './speculation-rules.js';

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

/** The subset of `hoofd`'s `toStatic()` output the document shell consumes. */
export type HeadStatic = {
  title?: string;
  lang?: string;
  metas?: Record<string, string | undefined>[];
  links?: Record<string, string | undefined>[];
};

/**
 * Assemble the full HTML document from the prerendered tree plus the collected
 * head metadata. Injects `<title>`/`<meta>`/`<link>`/speculation-rules into the
 * `</head>`, then either threads `lang` into a Layout-owned `<html>` or wraps a
 * fragment in the framework's `<html lang>` shell.
 *
 * Pure string assembly — no streaming concerns — so it is unit-testable in
 * isolation. The `</head>` injection is the one place coupled to the Layout's
 * markup; when the Layout owns the shell but emits no `</head>`, the head tags
 * would silently vanish, so we warn (see `warnMissingMarker`). A fragment with
 * no head is the supported custom-entry case and is left alone.
 */
export function assembleDocument(opts: {
  html: string;
  head: HeadStatic;
  defaultTitle?: string;
  appConfig?: AppConfig;
}): string {
  const { html, head, defaultTitle, appConfig } = opts;
  const { title, lang, metas = [], links = [] } = head;

  // Only inject a <title> when hoofd produced one or the caller provided a
  // defaultTitle. Layouts that render their own static <title> (via <Head>)
  // would otherwise be overridden by an empty injected one (browsers use the
  // last <title> in <head>).
  const titleSource = title ?? defaultTitle;
  const headTags = [
    titleSource != null ? `<title>${escapeHtml(titleSource)}</title>` : '',
    ...metas.map((m) => `<meta ${toAttrs(m)} />`),
    ...links.map((l) => `<link ${toAttrs(l)} />`),
    speculationRulesTag(appConfig ?? {}),
  ]
    .filter(Boolean)
    .join('\n        ');

  // If the rendered tree already starts with <html>, the user's Layout owns
  // the document shell. Inject hoofd's lang into that <html> tag (if hoofd
  // dispatched one) and emit only the doctype; do not double-wrap.
  // Otherwise (custom server entry rendering a fragment) keep the framework's
  // <html lang> wrapper for backward compatibility.
  const startsWithHtml = /^\s*<html(\s|>)/i.test(html);

  if (startsWithHtml && headTags && !html.includes('</head>')) {
    warnMissingMarker(
      '</head>',
      'the Layout owns the document (<html>…) but emitted no </head>; ' +
        'injected <title>/<meta>/<link> tags were dropped'
    );
  }
  const inner = html.replace('</head>', `${headTags}\n      </head>`);

  return startsWithHtml
    ? lang != null
      ? inner.replace(/<html(\s|>)/i, `<html lang="${escapeHtml(lang)}"$1`)
      : inner
    : `<html lang="${escapeHtml(lang ?? 'en-US')}">\n${inner}\n</html>`;
}

/**
 * Warn (once-ish, to the server console) that a Layout-markup marker the
 * document/stream assembly depends on was absent, so the silent-drop failure
 * mode of the regex seams is at least debuggable.
 */
export function warnMissingMarker(marker: string, detail: string): void {
  console.warn(`[hono-preact] expected ${marker} in rendered HTML: ${detail}.`);
}
