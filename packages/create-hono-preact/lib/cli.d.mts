export interface SpawnedProcess {
  on(event: string, listener: (code: number | null) => void): unknown;
}

export interface RunOptions {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  spawnFn?: (
    cmd: string,
    args: string[],
    opts: { cwd: string; stdio?: unknown },
  ) => SpawnedProcess;
  prompt?: (message: string) => Promise<string>;
}

export function run(options: RunOptions): Promise<number>;
