import path from 'node:path';
import type { UserConfig } from 'vite';

/**
 * The single resolved Vite project root for one `honoPreact()` call.
 *
 * The root is not knowable when `honoPreact()` runs: `userConfig.root` first
 * appears in a `config` hook. Every path decision that used to read
 * `process.cwd()` at plugin-construction time silently pointed at the wrong
 * tree under a custom `root`. This holder defers that read.
 *
 * `set` is first-writer-wins because two plugins call it with the same
 * `userConfig` and Vite's hook order between them is not ours to depend on:
 * `enforce: 'pre'` plugins run first, so `hono-preact:server-entry` wins over
 * `hono-preact:config`. Memoizing means the value an adapter already captured
 * can never be moved underneath it.
 */
export interface RootRef {
  /** Resolve and memoize the root from a `config` hook's userConfig. */
  set(userConfig: Pick<UserConfig, 'root'>): string;
  /** The resolved root, or `process.cwd()` before any `config` hook ran. */
  get(): string;
}

export function createRootRef(): RootRef {
  let root: string | undefined;
  return {
    set(userConfig) {
      root ??= userConfig.root ? path.resolve(userConfig.root) : process.cwd();
      return root;
    },
    get() {
      return root ?? process.cwd();
    },
  };
}
