import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from 'hono-preact';
import * as page from 'hono-preact/page';
import * as server from 'hono-preact/server';
import * as viteApi from 'hono-preact/vite';
import * as cloudflare from 'hono-preact/adapter-cloudflare';
import * as node from 'hono-preact/adapter-node';
import * as ui from 'hono-preact-ui';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..');

// Public runtime exports that are intentionally undocumented. Each entry is a
// deliberate choice (advanced Vite plumbing, or a feature kept out of the docs);
// add to this set ONLY with a one-line reason.
const INTENTIONALLY_UNDOCUMENTED = new Set<string>([
  // Advanced Vite plugin internals (not part of the documented surface):
  'serverLoaderValidationPlugin',
  'serverOnlyPlugin',
  'VITE_ROOT_ACCESSOR',
  'moduleKeyPlugin',
  'GENERATED_CORE_APP_RELATIVE',
  'GENERATED_ENTRY_WRAPPER_RELATIVE',
  'generatedCoreAppAbsPath',
  'generatedEntryWrapperAbsPath',
  'serverEntryPlugin',
  'clientEntryPlugin',
  'VIRTUAL_CLIENT_ENTRY_ID',
  'guardStripPlugin',
  // Advanced / escape-hatch exports (triaged 2026-06-14): the documented API is
  // the higher-level one noted on each line.
  'ActionResultContext', // low-level SSR context; useActionResult() is the documented API
  'isTimeout', // advanced predicate for inspecting timeout outcomes in custom handler code; timeouts themselves are documented via timeoutMs
  'timeoutOutcome', // advanced constructor for timeout outcomes in custom handler code; timeouts themselves are documented via timeoutMs
  'useRoute', // raw preact-iso re-export; useParams() is the documented route-params API
]);

// Public `hono-preact-ui` exports that are intentionally undocumented. Same
// contract as the runtime allowlist above: one stated reason per entry. Empty
// today (every UI export is documented); it exists so a deliberate future
// exception has a home instead of loosening the gate.
const UI_INTENTIONALLY_UNDOCUMENTED = new Set<string>([]);

function runtimeNames(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter((k) => k !== 'default');
}

// Compound UI components export a namespace object (`Dialog`) plus flat parts
// (`DialogClose`), and the docs cite parts in dot form (`Dialog.Close`). A
// namespace root is a top-level component name that prefixes other exports;
// deriving them from the barrel (rather than hardcoding) keeps this in sync as
// components are added. A part `DialogClose` is documented if the corpus
// mentions it flat OR as `Dialog.Close`.
function namespaceRoots(names: string[]): string[] {
  return names.filter(
    (n) =>
      /^[A-Z]/.test(n) &&
      names.some((o) => o !== n && o.startsWith(n)) &&
      !names.some((m) => m !== n && n.startsWith(m))
  );
}

function isDocumented(name: string, roots: string[]): boolean {
  if (new RegExp(`\\b${name}\\b`).test(corpus)) return true;
  const root = roots.find((r) => name.startsWith(r) && name.length > r.length);
  if (root) {
    const part = name.slice(root.length);
    return new RegExp(`\\b${root}\\.${part}\\b`).test(corpus);
  }
  return false;
}

function readCorpus(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(resolve(dir, entry.name));
      } else if (entry.name.endsWith('.mdx')) {
        parts.push(readFileSync(resolve(dir, entry.name), 'utf8'));
      }
    }
  };
  walk(docsDir);
  return parts.join('\n');
}

const corpus = readCorpus();
const allExports = [
  ...runtimeNames(root),
  ...runtimeNames(page),
  ...runtimeNames(server),
  ...runtimeNames(viteApi),
  ...runtimeNames(cloudflare),
  ...runtimeNames(node),
];

describe('public runtime exports are documented', () => {
  for (const name of [...new Set(allExports)].sort()) {
    if (INTENTIONALLY_UNDOCUMENTED.has(name)) continue;
    it(`documents ${name}`, () => {
      expect(
        new RegExp(`\\b${name}\\b`).test(corpus),
        `${name} not found in docs`
      ).toBe(true);
    });
  }
});

const uiExports = [...new Set(runtimeNames(ui))].sort();
const uiRoots = namespaceRoots(uiExports);

describe('public UI exports are documented', () => {
  for (const name of uiExports) {
    if (UI_INTENTIONALLY_UNDOCUMENTED.has(name)) continue;
    it(`documents ${name}`, () => {
      expect(
        isDocumented(name, uiRoots),
        `${name} not found in docs (checked flat and namespaced dot form)`
      ).toBe(true);
    });
  }
});
