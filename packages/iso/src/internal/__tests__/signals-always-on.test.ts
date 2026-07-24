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

  it('@preact/signals enters the graph ONLY through the two factory modules (core stays signals-free)', () => {
    // The always-loaded core reaches @preact/signals only if it imports one of
    // the factory modules, which the size probe (curated CORE_MODULES, ~5,521 B)
    // then catches. Pinning the factories as the sole importers is the
    // unit-level complement: signals cannot leak into any other module (and
    // thence into core) without tripping this test.
    const importers = sourceModules().filter((rel) =>
      reads(rel, "'@preact/signals'")
    );
    expect(importers.sort()).toEqual([
      'internal/loader-signal.ts',
      'internal/roster-signal.ts',
    ]);
  });

  it('the rendering helpers are pure Preact (no @preact/signals import)', () => {
    expect(reads('for.tsx', "'@preact/signals'")).toBe(false);
    expect(reads('show.tsx', "'@preact/signals'")).toBe(false);
  });
});
