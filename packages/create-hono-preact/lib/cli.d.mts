export interface SpawnedProcess {
  // The listener receives either an exit code ('close' event) or an Error
  // ('error' event); typed as unknown so the various fake-spawn shapes used
  // in tests all satisfy the contract.
  on(event: string, listener: (arg: unknown) => void): unknown;
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
