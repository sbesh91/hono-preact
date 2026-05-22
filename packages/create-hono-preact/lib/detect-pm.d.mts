export function detectPackageManager(
  env: Record<string, string | undefined>
): 'npm' | 'pnpm' | 'yarn' | 'bun';
