import type { PromptAdapter } from './prompts.mjs';

export interface ResolvedOptions {
  targetDir: string;
  adapter: 'cloudflare' | 'node';
  ui: boolean;
  install: boolean;
  git: boolean;
  skipHints: boolean;
}

export function checkTargetDir(
  dest: string,
  name: string
): string | undefined;

export function validateDirName(
  value: string,
  cwd: string
): string | undefined;

export function validateProjectName(name: string): string | undefined;

export function resolveOptions(
  parsed: {
    targetDir?: string;
    adapter?: 'cloudflare' | 'node';
    ui?: boolean;
    install?: boolean;
    git?: boolean;
    skipHints?: boolean;
  },
  ctx: { interactive: boolean; prompts: PromptAdapter; cwd: string }
): Promise<ResolvedOptions>;
