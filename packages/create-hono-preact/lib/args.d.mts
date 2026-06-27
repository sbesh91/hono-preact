export interface ParsedArgs {
  kind: 'help' | 'version' | 'error' | 'scaffold' | 'add-agents';
  targetDir?: string | undefined;
  adapter?: 'cloudflare' | 'node' | undefined;
  ui?: boolean | undefined;
  install?: boolean | undefined;
  git?: boolean | undefined;
  yes?: boolean;
  skipHints?: boolean;
  message?: string;
  force?: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs;
