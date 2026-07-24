import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Static import-graph checks encoding the always-on invariant: the data-layer
// modules reach @preact/signals, and the seam / opt-in entry are gone.
const here = dirname(fileURLToPath(import.meta.url));
const iso = join(here, '..', '..'); // packages/iso/src

function reads(rel: string, needle: string): boolean {
  return readFileSync(join(iso, rel), 'utf8').includes(needle);
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
});
