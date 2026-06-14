export interface ParsedArgs {
  kind: 'help' | 'version' | 'error' | 'scaffold' | 'add-agents';
  targetDir?: string | undefined;
  adapter?: 'cloudflare' | 'node';
  install?: boolean;
  git?: boolean;
  message?: string;
  force?: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs;
