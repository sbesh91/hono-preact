import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';

// Signals are the always-on data layer, and this file pins the one part of that
// which nothing else can catch: there is no seam to turn them off.
//
// The deleted seam was a pair of module-level registries
// (`register*ReactiveImpl` / `get*ReactiveImpl`) sitting between a consumer and
// the signal factories, so a consumer read through whichever implementation
// happened to be installed -- or through none, silently degrading. That shape is
// what produced two channels for one concept, and it would come back QUIETLY:
// adding a registry back keeps every call site compiling and every other test
// green.
//
// Two things this file deliberately does NOT assert any more:
//  - Which modules may import @preact/signals. It is a hard dependency of this
//    package and is re-exported from `index.ts`; there is no confinement left to
//    defend.
//  - That the data-layer modules produce signals. Their exported types name
//    `Signal` / `ReadonlySignal`, so tsc already enforces it and a text grep was
//    only ever a weaker restatement.
// The size consequence the old confinement stood in for (signals reaching the
// always-loaded core) is measured directly, in bytes, by
// `scripts/__tests__/core-size-floor.test.mjs`.
const here = dirname(fileURLToPath(import.meta.url));
const iso = join(here, '..', '..'); // packages/iso/src

// Every source module under packages/iso/src, as posix-style paths relative to
// it (e.g. 'internal/roster-signal.ts'), excluding tests.
function sourceModules(): string[] {
  return readdirSync(iso, { recursive: true, encoding: 'utf8' })
    .map((p) => p.split(sep).join('/'))
    .filter((p) => /\.tsx?$/.test(p) && !p.includes('__tests__'));
}

// The seam's own vocabulary. Matching on these names, rather than on the module
// that used to hold them, is what makes the check survive the registry being
// reintroduced somewhere else.
const SEAM_IDENTIFIERS = [
  'registerLoaderReactiveImpl',
  'getLoaderReactiveImpl',
  'registerPresenceReactiveImpl',
  'getPresenceReactiveImpl',
  'LoaderReactiveImpl',
  'PresenceReactiveImpl',
];

describe('signals are the always-on data layer', () => {
  it('has no opt-in registration seam in front of the signal factories', () => {
    const offenders = sourceModules().filter((rel) => {
      const src = readFileSync(join(iso, rel), 'utf8');
      return SEAM_IDENTIFIERS.some((id) => src.includes(id));
    });
    expect(offenders).toEqual([]);
  });
});
