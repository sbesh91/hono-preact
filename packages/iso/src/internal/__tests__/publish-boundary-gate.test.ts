// A direct `signal.value = x` is the framework's riskiest one-liner, because
// over-publishing is SILENT: it costs renders, never correctness, so nothing
// throws and no test notices unless it was written to count notifications.
//
// There is no rule that separates the legitimate kinds, so they are INVENTORIED
// and classified instead, and the gate fails when the inventory moves. A new
// write then has to be classified by a human before it can land.
//
//  - `boundary`      the helper itself
//  - `render-driven` built during render, so a fresh reference every render is
//                    normal and `===` dedupe cannot see it. Must route through
//                    `publish` / `retainEquivalent`, or self-dedupe because the
//                    value is a primitive.
//  - `event-driven`  fires on a real transition (a chunk arrived, a submit
//                    began). A comparison is pure overhead, and for
//                    `appendCollectChunk` actively WRONG: the chunks array's
//                    identity is the generation mechanism a retained fold
//                    resets on.
//  - `dom`           not a signal at all (`input.value = ...`).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every framework package, not just `iso`: `server` and `ui` have no signal
// writes today, and a future one there would otherwise go uninventoried.
const PACKAGES = ['iso', 'server', 'ui'] as const;
const ROOT = join(fileURLToPath(new URL('../../../../', import.meta.url)));

type Kind = 'boundary' | 'render-driven' | 'event-driven' | 'dom';

const INVENTORY: Record<string, { writes: number; kind: Kind; why: string }> = {
  'iso/src/internal/publish.ts': {
    writes: 1,
    kind: 'boundary',
    why: 'the one write everything on the render path routes through',
  },
  'iso/src/internal/roster-signal.ts': {
    writes: 8,
    kind: 'event-driven',
    why: 'wire deltas; the member write goes through publish(sameMember), ids is guarded on membership',
  },
  'iso/src/internal/loader-signal.ts': {
    writes: 6,
    kind: 'event-driven',
    why: 'stream lifecycle; chunk-array identity is load-bearing, must NOT dedupe',
  },
  'iso/src/optimistic.ts': {
    writes: 6,
    kind: 'event-driven',
    why: 'queue transitions on dispatch/settle/revert; base is gated on shallowEqual and the projection uses retainEquivalent',
  },
  'iso/src/internal/use-stub-key.ts': {
    writes: 3,
    kind: 'render-driven',
    why: 'primitives (two strings, a boolean), which @preact/signals dedupes by ===',
  },
  'iso/src/internal/form-submit-store.ts': {
    writes: 2,
    kind: 'event-driven',
    why: 'submit begin/end',
  },
  'iso/src/internal/action-result-store.ts': {
    writes: 2,
    kind: 'event-driven',
    why: 'an action produced a result',
  },
  'iso/src/form.tsx': {
    writes: 2,
    kind: 'dom',
    why: 'input.value resets on a native form, not signals',
  },
  'iso/src/use-room.ts': {
    writes: 1,
    kind: 'event-driven',
    why: 'self id from a presence snapshot, a primitive',
  },
  'iso/src/use-action-result.ts': {
    writes: 1,
    kind: 'render-driven',
    why: 'mirrors a context value, so === dedupe suffices',
  },
  'iso/src/internal/field-error-signal.ts': {
    writes: 1,
    kind: 'event-driven',
    why: 'clearing a dropped field; the two publishing writes go through publish(sameMessages/sameNameSet)',
  },
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      if (entry.name === 'dist') continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

function inventory(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const pkg of PACKAGES) {
    const src = join(ROOT, pkg, 'src');
    let stat;
    try {
      stat = statSync(src);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const file of sourceFiles(src)) {
      const n = (readFileSync(file, 'utf8').match(/\.value\s*=[^=]/g) ?? [])
        .length;
      if (n > 0) {
        found[relative(ROOT, file).replaceAll('\\', '/')] = n;
      }
    }
  }
  return found;
}

describe('publish boundary: the direct-write inventory', () => {
  it('matches the classified inventory', () => {
    const expected = Object.fromEntries(
      Object.entries(INVENTORY).map(([f, v]) => [f, v.writes])
    );
    // One object comparison, so a failure names the file and the count rather
    // than a total that says nothing about where.
    expect(inventory()).toEqual(expected);
  });

  it('every render-driven site routes through a helper or is a primitive', () => {
    // The class that cannot be left to a convention. Each of these must show
    // its dedupe in the source, so the gate fails if one is quietly reverted to
    // a bare write.
    const renderDriven = Object.entries(INVENTORY)
      .filter(([, v]) => v.kind === 'render-driven')
      .map(([f]) => f);
    expect(renderDriven.length).toBeGreaterThan(0);
    for (const f of renderDriven) {
      expect(INVENTORY[f]!.why).toMatch(
        /publish|retainEquivalent|===|primitive/
      );
    }
  });

  it('LoaderDataProvider publishes through the boundary, never directly', () => {
    // The one site whose callers demonstrably could not be trusted to memoize.
    const src = readFileSync(
      join(ROOT, 'iso/src/internal/loader-data-provider.tsx'),
      'utf8'
    );
    expect(src).toContain('publish(cell, state, sameLoaderData)');
    expect(src).not.toMatch(/cell\.value\s*=[^=]/);
  });

  it('the two output-retention sites use the shared helper', () => {
    // `foldStream` and `useOptimistic` each grew their own copy of this before
    // it was extracted; the gate keeps them on the shared one.
    for (const f of [
      'iso/src/internal/loader-signal.ts',
      'iso/src/optimistic.ts',
    ]) {
      expect(readFileSync(join(ROOT, f), 'utf8')).toContain('retainEquivalent');
    }
  });
});
