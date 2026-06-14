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
  // Kept undemoed/undocumented by design (see Section F notes):
  'defineStreamObserver',
  'Persist',
  'PersistHost',
  // Advanced / escape-hatch exports (triaged 2026-06-14): the documented API is
  // the higher-level one noted on each line.
  'ActionResultContext', // low-level SSR context; useActionResult() is the documented API
  'isTimeout', // advanced predicate for inspecting timeout outcomes in custom handler code; timeouts themselves are documented via timeoutMs
  'timeoutOutcome', // advanced constructor for timeout outcomes in custom handler code; timeouts themselves are documented via timeoutMs
  'useRoute', // raw preact-iso re-export; useParams() is the documented route-params API
]);

function runtimeNames(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter((k) => k !== 'default');
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
