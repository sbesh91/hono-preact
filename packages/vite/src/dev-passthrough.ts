// Deciding, for one dev request, whether Vite owns it or the SSR app does.
//
// The Node adapter's dev middleware runs ahead of Vite's transform middleware
// (so Vite's SPA fallback cannot rewrite the URL out from under the SSR app),
// which means it must hand back everything Vite is responsible for. Vite's
// special prefixes (`/@id/`, `/@fs/`, ...) are one part of that; the other is
// ordinary project files, which carry no distinguishing prefix at all. A
// request for `/src/routes.ts` looks exactly like a request for `/about`.
//
// The discriminator is existence: `/src/routes.ts` names a real file in the
// project, `/about` does not. That is preferred over an extension allowlist
// (the shape `@hono/vite-dev-server` uses) because an allowlist has to be
// right in both directions and cannot be:
//
//   - Too narrow and it misses imported assets. `import logo from './logo.png'`
//     is served by Vite exactly like a `.ts` module, as are fonts, `.svg`,
//     `.wasm`, and whatever the next plugin introduces.
//   - Too wide and it swallows real application routes. `/llms.txt` and
//     `/llms-full.txt` are build-emitted assets the app serves in dev with no
//     file on disk (see `apps/site/vite.config.ts`), so an allowlist
//     containing `.txt` would break them.
//
// Existence answers both without enumerating anything.

import * as path from 'node:path';

export interface ProjectFileProbe {
  /** Vite's resolved `config.root`. */
  root: string;
  /** Vite's resolved `config.publicDir`, or `false`/empty when disabled. */
  publicDir?: string | false;
  /** Existence probe. Injected so the decision stays unit-testable. */
  fileExists: (absolutePath: string) => boolean;
}

/**
 * True when `urlPath` names a real file Vite serves out of the project, and so
 * must not be answered by the SSR app.
 *
 * `urlPath` is a request path with the query already stripped. It is decoded
 * here (a source path may legitimately contain a space) and confined to the
 * project: a decoded path that escapes `root` / `publicDir` is never probed and
 * never claimed, so a crafted URL cannot turn this into an arbitrary
 * filesystem oracle.
 */
export function isViteProjectFile(
  urlPath: string,
  probe: ProjectFileProbe
): boolean {
  const decoded = decodePath(urlPath);
  if (decoded === undefined) return false;
  // A NUL byte truncates a path at the syscall boundary on some platforms, so
  // `/src/routes.ts\0.png` could probe a different file than it appears to.
  // Refuse rather than normalize.
  if (decoded.includes('\0')) return false;

  const roots = [probe.root, probe.publicDir].filter(
    (r): r is string => typeof r === 'string' && r.length > 0
  );
  return roots.some((root) => {
    const abs = confineToRoot(root, decoded);
    return abs !== undefined && probe.fileExists(abs);
  });
}

/**
 * Percent-decode a request path, or `undefined` when it is malformed.
 * A path we cannot decode is one we cannot reason about, so it is treated as
 * "not a project file" and left to the SSR app.
 */
function decodePath(urlPath: string): string | undefined {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
}

/**
 * Resolve `urlPath` under `root`, or `undefined` if the result escapes it.
 * Resolution happens before the containment check, so `..` segments are
 * collapsed first and cannot smuggle a path out.
 */
function confineToRoot(root: string, urlPath: string): string | undefined {
  const resolvedRoot = path.resolve(root);
  const abs = path.resolve(resolvedRoot, '.' + path.posix.sep + urlPath);
  if (abs === resolvedRoot) return undefined;
  return abs.startsWith(resolvedRoot + path.sep) ? abs : undefined;
}
