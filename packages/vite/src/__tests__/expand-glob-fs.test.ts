// Direct coverage for `expandGlobFs`, the only fs-touching path in hint
// discovery (#326). Every other route-preload test substitutes a fake expander
// (`route-preload.test.ts` maps a pattern straight to keys), so the real walk,
// the pattern parse, and the `catch {}` were entirely unexercised.
//
// Uses a real temp directory rather than a mocked `fs`: the behaviors worth
// pinning here (recursion, extension matching, separator normalization,
// unreadable dirs) are exactly the ones a mock would have to reimplement, and
// a reimplemented fs proves nothing about the real one.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expandGlobFs } from '../route-preload.js';

let root: string;

function touch(rel: string): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, '');
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'hp-glob-'));
  touch('pages/home.tsx');
  touch('pages/about.tsx');
  touch('pages/readme.md');
  touch('pages/docs/guide.tsx');
  touch('pages/docs/deep/nested.tsx');
  touch('other/stray.tsx');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('expandGlobFs', () => {
  it('returns [] for a pattern it cannot parse', () => {
    // No trailing `*.ext`, so the regex does not match at all. This is the
    // branch that silently disables route hints for a mis-typed glob.
    expect(expandGlobFs('./pages/**', root)).toEqual([]);
    expect(expandGlobFs('./pages/home.tsx', root)).toEqual([]);
  });

  it('matches a single level only, without `**/`', () => {
    expect(expandGlobFs('./pages/*.tsx', root).sort()).toEqual([
      './pages/about.tsx',
      './pages/home.tsx',
    ]);
  });

  it('recurses into subdirectories with `**/`', () => {
    expect(expandGlobFs('./pages/**/*.tsx', root).sort()).toEqual([
      './pages/about.tsx',
      './pages/docs/deep/nested.tsx',
      './pages/docs/guide.tsx',
      './pages/home.tsx',
    ]);
  });

  it('filters by extension', () => {
    expect(expandGlobFs('./pages/*.md', root)).toEqual(['./pages/readme.md']);
  });

  it('scopes the walk to the literal prefix', () => {
    // `other/stray.tsx` exists but sits outside the prefix, so it must not leak
    // into a `./pages/**` expansion.
    expect(expandGlobFs('./pages/**/*.tsx', root)).not.toContain(
      './other/stray.tsx'
    );
  });

  it('emits `./`-prefixed POSIX keys relative to fromDir', () => {
    for (const key of expandGlobFs('./pages/**/*.tsx', root)) {
      expect(key.startsWith('./')).toBe(true);
      expect(key).not.toContain('\\');
    }
  });

  it('tolerates a prefix with no `./` and an absent directory', () => {
    expect(expandGlobFs('pages/*.tsx', root).sort()).toEqual([
      './pages/about.tsx',
      './pages/home.tsx',
    ]);
    // The `catch {}` around readdirSync: a missing dir degrades to no hints
    // rather than failing the build (preload is an optimization, never
    // correctness).
    expect(expandGlobFs('./does-not-exist/*.tsx', root)).toEqual([]);
  });
});
