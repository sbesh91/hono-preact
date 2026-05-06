import * as path from 'node:path';

/**
 * Derive the stable module key for a `.server.*` file.
 *
 * The key is the file's path relative to the Vite project root, with the
 * `.server.{ts,tsx,js,jsx}` extension stripped, and path separators
 * normalized to forward slashes (so the key is identical on Windows and
 * POSIX). Used as the routing key for `__loaders`/`__actions` RPC, the
 * payload of `Symbol.for(...)` for `__id`, and the value of the
 * module-level `__moduleKey` export.
 */
export function deriveModuleKey(absPath: string, viteRoot: string): string {
  // Normalize backslashes to forward slashes before computing the relative
  // path so that Windows-style inputs work correctly on any platform.
  const normalizedAbs = absPath.replace(/\\/g, '/');
  const normalizedRoot = viteRoot.replace(/\\/g, '/');
  const rel = path.posix.relative(normalizedRoot, normalizedAbs);
  const stripped = rel.replace(/\.server\.[jt]sx?$/, '');
  return stripped;
}
