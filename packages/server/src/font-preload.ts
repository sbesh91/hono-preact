// Font preload helpers: infer a font URL's MIME type from its extension and
// build the `Link` response-header entries. The head `<link rel="preload">`
// tags render in document-shell.ts (which owns HTML escaping); this module is
// the pure type/header logic, unit-testable without the document shell.

/** The MIME type for a font URL by extension, or undefined if unrecognized. */
export function fontMimeType(href: string): string | undefined {
  const ext = href.split('?')[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'woff2':
      return 'font/woff2';
    case 'woff':
      return 'font/woff';
    case 'ttf':
      return 'font/ttf';
    case 'otf':
      return 'font/otf';
    default:
      return undefined;
  }
}

/**
 * An RFC 8288 `Link` header value preloading the given font URLs, or undefined
 * when there are none (so callers skip the header rather than emit an empty
 * one). Each entry is `rel=preload; as=font; crossorigin` (fonts are always
 * fetched in CORS mode, so crossorigin is required to reuse the preload) plus
 * `type=<mime>` when the extension is recognized. Promotable to 103 Early Hints.
 */
export function fontPreloadLinkHeader(
  fonts: readonly string[]
): string | undefined {
  const entries = fonts.map((href) => {
    const type = fontMimeType(href);
    const parts = [`<${href}>`, 'rel=preload', 'as=font'];
    if (type) parts.push(`type=${type}`);
    parts.push('crossorigin');
    return parts.join('; ');
  });
  return entries.length > 0 ? entries.join(', ') : undefined;
}
