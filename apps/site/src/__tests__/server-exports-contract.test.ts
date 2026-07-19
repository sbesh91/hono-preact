import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { serverLoaderValidationPlugin } from 'hono-preact/vite';

// #289: a `.server.*` module may only declare the runtime named exports on the
// framework whitelist (serverLoaders / serverActions / serverRooms /
// serverSockets). The build enforces this via serverLoaderValidationPlugin,
// but only for files reachable from the build graph, and a failure there
// surfaces only in CI's site-build step (the last check to run). This runs the
// SAME plugin against every `.server.*` source in the site so a stray helper
// export fails the fast `pnpm test` suite instead. It reuses the plugin, which
// imports the canonical RECOGNIZED_SERVER_EXPORTS, rather than re-deriving the
// whitelist here (which would drift from the real contract).

type TransformFn = (code: string, id: string) => void;

function validate(code: string, id: string): string | null {
  const plugin = serverLoaderValidationPlugin() as Plugin & {
    transform: TransformFn;
  };
  const context = {
    error: (msg: string) => {
      throw new Error(msg);
    },
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin.transform.call(context as any, code, id);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const siteSrc = join(here, '..');

function collectServerFiles(root: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === 'node_modules') continue;
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      out = out.concat(collectServerFiles(full));
    } else if (full.endsWith('.server.ts') || full.endsWith('.server.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('site .server.* export whitelist (#289)', () => {
  const files = collectServerFiles(siteSrc);

  it('finds the site .server.* modules to check', () => {
    // Guard against a broken enumeration silently making the whitelist
    // assertion below pass vacuously.
    expect(files.length).toBeGreaterThan(0);
  });

  it('declares only whitelisted runtime named exports', () => {
    const violations = files
      .map((file) => ({
        file,
        error: validate(readFileSync(file, 'utf8'), file),
      }))
      .filter((r): r is { file: string; error: string } => r.error !== null)
      .map((r) => `${relative(siteSrc, r.file)}: ${r.error}`);
    expect(violations).toEqual([]);
  });
});
