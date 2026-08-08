// A direct `signal.value = x` is the framework's riskiest one-liner, because
// over-publishing is SILENT: it costs renders, never correctness, so nothing
// throws, nothing fails, and no test notices unless it was written to count
// notifications. Every defect in #361's evidence table that a publish boundary
// would have caught was one of these.
//
// So the writes are inventoried rather than policed by a rule that cannot tell
// the two legitimate kinds apart:
//
//  - RENDER-DRIVEN: the value is built during render, so a fresh reference
//    every render is normal and `===` dedupe cannot see it. These must go
//    through `publish()` (or dedupe their own output) or they wake every
//    consumer for nothing.
//  - EVENT-DRIVEN: the write happens on a real transition (a chunk arrived, a
//    submit began, a member left). A comparison there is pure overhead, and for
//    `appendCollectChunk` it is actively wrong, because the chunks array's
//    IDENTITY is the generation mechanism a retained fold's cursor resets on.
//
// This test does not judge which kind a site is; it fails when the inventory
// moves, so a new write has to be classified by a human before it lands.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * file -> how many direct `.value =` writes it contains, and why they are the
 * kind they are. Update this deliberately, with the reason, when a write is
 * added or removed.
 */
const INVENTORY: Record<string, { writes: number; kind: string }> = {
  'internal/publish.ts': {
    writes: 1,
    kind: 'the boundary itself; this is the write everything else should route through',
  },
  'internal/roster-signal.ts': {
    writes: 9,
    kind: 'event-driven (wire deltas); the per-member and ids writes dedupe via writeMember/shallowEqual',
  },
  'internal/loader-signal.ts': {
    writes: 6,
    kind: 'event-driven (stream lifecycle); chunk-array identity is load-bearing, do NOT dedupe',
  },
  'optimistic.ts': {
    writes: 6,
    kind: 'mixed; base is gated on shallowEqual, reducer is a function so its OUTPUT is deduped instead, queue writes are event-driven',
  },
  'internal/use-stub-key.ts': {
    writes: 3,
    kind: 'render-driven but primitives (two strings, a boolean), which @preact/signals dedupes by ===',
  },
  'internal/field-error-signal.ts': {
    writes: 3,
    kind: 'event-driven (a form result); guarded by sameMessages / sameNameSet',
  },
  'internal/form-submit-store.ts': {
    writes: 2,
    kind: 'event-driven (submit begin/end)',
  },
  'internal/action-result-store.ts': {
    writes: 2,
    kind: 'event-driven (an action produced a result)',
  },
  'form.tsx': {
    writes: 2,
    kind: 'not signals at all: DOM input.value resets',
  },
  'use-room.ts': {
    writes: 1,
    kind: 'render-independent (self id, a primitive)',
  },
  'use-action-result.ts': {
    writes: 1,
    kind: 'render-driven but mirrors a context value, so === dedupe suffices',
  },
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

describe('publish boundary: the direct-write inventory', () => {
  it('matches the classified inventory', () => {
    const found: Record<string, number> = {};
    for (const file of sourceFiles(SRC)) {
      const n = (readFileSync(file, 'utf8').match(/\.value = /g) ?? []).length;
      if (n > 0) found[relative(SRC, file).replaceAll('\\', '/')] = n;
    }

    const expected = Object.fromEntries(
      Object.entries(INVENTORY).map(([f, v]) => [f, v.writes])
    );

    // A single object comparison so the diff names the file and the count,
    // rather than failing on a total that says nothing about where.
    expect(found).toEqual(expected);
  });

  it('LoaderDataProvider publishes through the boundary, never directly', () => {
    // The one site whose callers demonstrably could not be trusted to memoize.
    const src = readFileSync(
      join(SRC, 'internal/loader-data-provider.tsx'),
      'utf8'
    );
    expect(src).toContain('publish(cell, state, sameLoaderData)');
    expect(src).not.toMatch(/cell\.value = /);
  });
});
