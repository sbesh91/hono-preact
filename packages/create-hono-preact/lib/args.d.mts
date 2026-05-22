export interface ParsedArgs {
  kind: 'help' | 'version' | 'error' | 'scaffold';
  targetDir?: string | undefined;
  adapter?: 'cloudflare' | 'node';
  install?: boolean;
  git?: boolean;
  message?: string;
}

export function parseArgs(argv: string[]): ParsedArgs;
