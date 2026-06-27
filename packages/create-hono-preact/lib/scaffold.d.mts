export function scaffold(
  targetDir: string,
  options: { adapter: 'cloudflare' | 'node'; ui: boolean },
  templatesRoot: string
): Promise<void>;
