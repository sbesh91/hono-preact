// Fail-fast Node preflight. Scaffolding itself runs on older Node, but the
// scaffolded app depends on hono-preact, whose supported range is stricter;
// without this check the scaffold succeeds and the first `pnpm dev` fails
// with an unrelated-looking error.

/**
 * The Node range hono-preact supports. Keep in sync with the framework's
 * package.json `engines.node` and this package's own `engines.node`.
 */
export const SUPPORTED_NODE_RANGE = '^22.18.0 || >=24.11.0';

/**
 * Check a Node version string (e.g. `process.version`, "v22.18.0") against
 * the supported range. Returns an error message to print when the version is
 * outside the range, or undefined when it is fine. An unparseable version
 * fails open (returns undefined) rather than blocking unusual builds.
 *
 * @param {string} version
 * @returns {string | undefined}
 */
export function nodeVersionError(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  // ^22.18.0 (>=22.18 within major 22) || >=24.11.0.
  const supported =
    (major === 22 && minor >= 18) ||
    (major === 24 && minor >= 11) ||
    major > 24;
  if (supported) return undefined;
  return (
    `Node ${SUPPORTED_NODE_RANGE} is required (the range hono-preact ` +
    `supports); you are running ${version}. Upgrade Node and re-run.`
  );
}
