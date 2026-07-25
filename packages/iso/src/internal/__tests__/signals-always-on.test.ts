import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';

// Static import-graph checks encoding the always-on invariant: the data-layer
// modules reach @preact/signals, the core stays signals-free, and the seam /
// opt-in entry are gone.
const here = dirname(fileURLToPath(import.meta.url));
const iso = join(here, '..', '..'); // packages/iso/src

function reads(rel: string, needle: string): boolean {
  return readFileSync(join(iso, rel), 'utf8').includes(needle);
}

// A plain `import { ... } from '@preact/signals'` (or `export { ... } from`)
// pulls the signal factories into the runtime module graph. An `import type`
// line does not: TS erases it entirely, so it never reaches the bundle. A
// mixed specifier list (`import { signal, type Signal } from ...`) still
// counts, since the value part survives erasure. Several modules hold a
// type-only `ReadonlySignal` import (the public read type), which must NOT
// count as "entering the graph" for this check to track the real invariant.
function importsSignalValuesAtRuntime(rel: string): boolean {
  const src = readFileSync(join(iso, rel), 'utf8');
  // `[^;]*?` (lazy, spans newlines but never a `;`) handles a wrapped
  // specifier list, e.g. `index.ts`'s multi-line
  // `export { signal, ... } from '@preact/signals';`, while staying bounded
  // to a single statement: excluding `;` stops a match from ever reaching
  // past an unrelated statement's terminator into a LATER import/export line.
  return /^(?:import|export)\s+(?!type\b)[^;]*?from\s+'@preact\/signals';/m.test(
    src
  );
}

// Every source module under packages/iso/src, as posix-style paths relative to
// it (e.g. 'internal/roster-signal.ts'), excluding tests.
function sourceModules(): string[] {
  return readdirSync(iso, { recursive: true, encoding: 'utf8' })
    .map((p) => p.split(sep).join('/'))
    .filter((p) => /\.tsx?$/.test(p) && !p.includes('__tests__'));
}

describe('signals are the always-on data layer', () => {
  it('the roster + loader signal modules import @preact/signals', () => {
    expect(reads('internal/roster-signal.ts', "'@preact/signals'")).toBe(true);
    expect(reads('internal/loader-signal.ts', "'@preact/signals'")).toBe(true);
  });

  it('useRoom / loader consume the signal factories directly (no registration seam)', () => {
    expect(reads('use-room.ts', 'createSignalRoster')).toBe(true);
    expect(reads('internal/loader.tsx', 'createPhaseCell')).toBe(true);
    expect(reads('define-loader.ts', 'derive')).toBe(true);
    // The removed seam is gone from reactive.ts.
    expect(reads('internal/reactive.ts', 'registerPresenceReactiveImpl')).toBe(
      false
    );
    expect(reads('internal/reactive.ts', 'getLoaderReactiveImpl')).toBe(false);
  });

  it('@preact/signals enters the graph ONLY through the factory modules (core stays signals-free)', () => {
    // The always-loaded core reaches @preact/signals only if it imports one of
    // the factory modules, which the size probe (curated CORE_MODULES, ~5,521 B)
    // then catches. Pinning the factories as the sole RUNTIME importers is the
    // unit-level complement: signals cannot leak into any other module (and
    // thence into core) without tripping this test. `index.ts` is the barrel's
    // own first-party re-export (Task 1) and is excluded from CORE_MODULES by
    // the size probe, so it is a legitimate value-importer here too. A
    // type-only `ReadonlySignal` import (the public read type, held by several
    // rendering/data modules) is erased at build and does not count.
    // `internal/store-signal.ts` is the sanctioned importer for the action /
    // form / optimistic stores (Phase 3): those store modules read/write
    // through `createStoreSignal` and never import `@preact/signals` directly.
    const importers = sourceModules().filter((rel) =>
      importsSignalValuesAtRuntime(rel)
    );
    expect(importers.sort()).toEqual([
      'index.ts',
      'internal/loader-signal.ts',
      'internal/roster-signal.ts',
      'internal/store-signal.ts',
    ]);
  });

  it('the rendering helpers are pure Preact (no @preact/signals runtime import)', () => {
    expect(importsSignalValuesAtRuntime('for.tsx')).toBe(false);
    expect(importsSignalValuesAtRuntime('show.tsx')).toBe(false);
  });
});
