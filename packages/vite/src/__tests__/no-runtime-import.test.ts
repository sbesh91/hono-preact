import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Vite plugin is BUILD-TIME code. It must never reach the framework's
 * RUNTIME modules, and above all never `@preact/signals`.
 *
 * Vite loads `vite.config.ts` by bundling it and importing it into the Node
 * process. So anything the plugin imports is evaluated in that process, and
 * `@preact/signals` installs Preact `options` hooks as an import side effect.
 * Under the Node adapter the dev server shares that same process, so a SECOND
 * `@preact/signals` instance later arrived through Vite's SSR module runner.
 * Both patched the one shared Preact `options`, both chained an `options.__r`
 * hook, and a SINGLE component render therefore started the same per-component
 * effect twice -> `Cycle detected`, a 500 on EVERY page of EVERY node-adapter
 * app. (Cloudflare was immune only by accident: workerd is a separate isolate,
 * so the config-time copy patched a Preact the worker never used.)
 *
 * The edge was invisible because it ran through a barrel: the plugin imported
 * four *string constants* from `@hono-preact/iso/internal/runtime`, and that
 * barrel re-exports `loader-stub` -> `define-loader` -> `@preact/signals`.
 * Importing a constant dragged in the entire data layer.
 *
 * The fix, which this test pins: build-time code imports only
 * `@hono-preact/iso/internal/contract`, a module that is pure constants and has
 * NO imports of its own. Both halves are asserted below, because the rule only
 * holds while `contract.ts` stays import-free.
 */

const here = dirname(fileURLToPath(import.meta.url));
const viteSrc = resolve(here, '..');
const contractPath = resolve(here, '../../../iso/src/internal/contract.ts');

/** Every `.ts` file in the plugin package, excluding tests and fixtures. */
function pluginSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pluginSourceFiles(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

/** Bare (non-relative) module specifiers imported or re-exported by `src`. */
function bareSpecifiers(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) out.push(m[1]);
  }
  return out;
}

describe('the Vite plugin never imports runtime code', () => {
  it('imports no @preact/signals and no iso runtime barrel', () => {
    const offenders: string[] = [];

    for (const file of pluginSourceFiles(viteSrc)) {
      for (const spec of bareSpecifiers(readFileSync(file, 'utf8'))) {
        const forbidden =
          spec.startsWith('@preact/signals') ||
          spec === '@hono-preact/iso' ||
          spec === '@hono-preact/iso/internal/runtime' ||
          spec === '@hono-preact/iso/internal';
        if (forbidden) {
          offenders.push(`${file.slice(viteSrc.length + 1)} -> ${spec}`);
        }
      }
    }

    expect(
      offenders,
      'Build-time plugin code reached the runtime. Import build-time ' +
        'constants from @hono-preact/iso/internal/contract instead.\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  // The rule above is only safe because `contract.ts` is a leaf. The moment it
  // imports anything, the barrel problem returns through a new door.
  it('keeps internal/contract.ts import-free, so it stays a safe leaf', () => {
    const contract = readFileSync(contractPath, 'utf8');
    expect(bareSpecifiers(contract)).toEqual([]);
    expect(contract).not.toMatch(/^\s*import\s/m);
  });
});
