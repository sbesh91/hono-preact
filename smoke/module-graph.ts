/**
 * Walk the module graph a rendered page boots, and check that every module in
 * it is actually served as JavaScript.
 *
 * A page can return a flawless `200 text/html` with correct SSR markup while
 * the client it ships is dead on arrival. That is #392: the Node adapter's dev
 * middleware answered `/src/routes.ts` (statically imported by the client
 * entry) with the SSR document, the browser rejected the module on strict MIME
 * checking, and no Node-adapter app hydrated under `vite dev`. Every status
 * code involved was 200. "The server can render its pages" and "the client the
 * server just shipped can load" are two different claims, and a status check
 * only makes the first.
 *
 * The content-type assertion is the load-bearing part: `200 text/html` for a
 * module request is the signature of "the framework's router answered
 * something Vite (or the static-asset middleware) should have", which is a
 * recurring hazard because that middleware runs ahead of Vite's.
 *
 * Deliberately no browser. Fetching the graph catches the whole #392 failure
 * mode at the cost of a few HTTP requests; asserting that hydration actually
 * *runs* needs Playwright, which is a separate decision on its own merits.
 */

/** A module that did not come back as JavaScript. */
export type GraphFailure = {
  /** Absolute URL fetched. */
  url: string;
  status: number;
  contentType: string;
  /** The module that imported it, or `'<document>'` for a page script. */
  via: string;
  /** First bytes of the body, so a failure names what came back instead. */
  bodyHead: string;
};

export type GraphResult = {
  /** Every module URL fetched, in discovery order. */
  checked: string[];
  failures: GraphFailure[];
};

export type WalkOptions = {
  /**
   * How many levels of static imports to follow past the document's own
   * scripts. The #392 shape is depth 1 (the entry's own import); the default
   * goes one further without letting a big app's graph turn this into a crawl.
   */
  maxDepth?: number;
  /** Hard cap on modules fetched, so a pathological graph cannot hang CI. */
  maxModules?: number;
};

const JS_CONTENT_TYPE = /javascript|ecmascript/i;

/**
 * Module scripts the document itself ships: `src` URLs plus the bodies of
 * inline `type="module"` blocks (dev entries are frequently inline imports).
 */
export function moduleScripts(html: string): {
  srcs: string[];
  inline: string[];
} {
  const srcs: string[] = [];
  const inline: string[] = [];
  const tag = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(tag)) {
    const attrs = m[1] ?? '';
    if (!/\btype\s*=\s*["']module["']/i.test(attrs)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (src) srcs.push(src);
    else if (m[2]?.trim()) inline.push(m[2]);
  }
  return { srcs, inline };
}

/**
 * Static import specifiers in a module's source.
 *
 * Comments are stripped first, and each match must sit at a statement
 * boundary, so a `'./thing.js'` string sitting in ordinary code is not mistaken
 * for an import. Being conservative matters more than being exhaustive here: a
 * false positive would fetch a URL that does not exist and fail the suite for
 * the wrong reason. Dynamic `import()` is deliberately not followed -- it is
 * lazily loaded, so it is not part of the boot graph this check is about.
 */
export function staticImports(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const out: string[] = [];
  const withClause =
    /(?:^|[\s;}])(?:import|export)\s[\s\S]{0,400}?\sfrom\s*["']([^"']+)["']/g;
  const bare = /(?:^|[\s;}])import\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(withClause)) out.push(m[1]!);
  for (const m of code.matchAll(bare)) out.push(m[1]!);
  return out;
}

/**
 * Resolve a specifier against the module that imported it, keeping only
 * same-origin URLs.
 *
 * A bare specifier (`preact`) is skipped rather than failed: an unresolved bare
 * specifier in served output is a bundler concern, and both Vite dev and the
 * production build rewrite the ones that matter into absolute URLs before they
 * reach a browser.
 */
export function resolveModuleUrl(
  specifier: string,
  fromUrl: string,
  origin: string
): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
    const abs = URL.parse(specifier);
    return abs && abs.origin === origin ? abs.href : null;
  }
  if (!specifier.startsWith('/') && !specifier.startsWith('.')) return null;
  return URL.parse(specifier, fromUrl)?.href ?? null;
}

/**
 * Fetch every module the document at `pageUrl` boots and report the ones that
 * did not come back as JavaScript.
 *
 * Returns rather than asserts: the caller owns the failure message, and a
 * caller that asserts `checked.length` keeps a walk that found nothing from
 * reading as a pass.
 */
export async function walkBootGraph(
  pageUrl: string,
  html: string,
  options: WalkOptions = {}
): Promise<GraphResult> {
  const { maxDepth = 2, maxModules = 60 } = options;
  const origin = new URL(pageUrl).origin;
  const { srcs, inline } = moduleScripts(html);

  const seen = new Set<string>();
  const checked: string[] = [];
  const failures: GraphFailure[] = [];

  // Inline module blocks are already executing in the document, so they are not
  // fetched; their imports enter the queue as the document's own edges.
  const queue: Array<{ url: string; via: string; depth: number }> = [];
  const enqueue = (
    specifier: string,
    fromUrl: string,
    via: string,
    depth: number
  ) => {
    const url = resolveModuleUrl(specifier, fromUrl, origin);
    if (!url || seen.has(url)) return;
    seen.add(url);
    queue.push({ url, via, depth });
  };

  for (const src of srcs) enqueue(src, pageUrl, '<document>', 0);
  for (const body of inline)
    for (const spec of staticImports(body))
      enqueue(spec, pageUrl, '<document inline script>', 0);

  while (queue.length > 0 && checked.length < maxModules) {
    const { url, via, depth } = queue.shift()!;
    checked.push(url);

    // A module the server refuses outright is a graph failure like any other,
    // not a harness crash: letting the fetch throw would abort the walk and
    // report a bare network error instead of naming the module and its
    // importer.
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      failures.push({
        url,
        status: 0,
        contentType: '',
        via,
        bodyHead: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();

    if (res.status !== 200 || !JS_CONTENT_TYPE.test(contentType)) {
      failures.push({
        url,
        status: res.status,
        contentType,
        via,
        bodyHead: body.slice(0, 200),
      });
      // Do not walk a module that is not a module: its "imports" would be
      // whatever the HTML error page happens to contain.
      continue;
    }

    if (depth < maxDepth)
      for (const spec of staticImports(body))
        enqueue(spec, url, url, depth + 1);
  }

  return { checked, failures };
}

/** One readable block per failure, for a test's assertion message. */
export function formatGraphFailures(result: GraphResult): string {
  return result.failures
    .map(
      (f) =>
        `${f.url}\n  imported by: ${f.via}\n  -> ${f.status} ${f.contentType}\n  body: ${f.bodyHead.replace(/\s+/g, ' ').slice(0, 160)}`
    )
    .join('\n\n');
}
