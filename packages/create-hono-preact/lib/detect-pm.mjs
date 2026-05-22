/**
 * Read `npm_config_user_agent` to pick a package manager. Falls back to pnpm.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {'npm' | 'pnpm' | 'yarn' | 'bun'}
 */
export function detectPackageManager(env) {
  const ua = env.npm_config_user_agent ?? '';
  if (ua.startsWith('npm/')) return 'npm';
  if (ua.startsWith('pnpm/')) return 'pnpm';
  if (ua.startsWith('yarn/')) return 'yarn';
  if (ua.startsWith('bun/')) return 'bun';
  return 'pnpm';
}
