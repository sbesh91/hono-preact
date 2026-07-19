import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceAliases } from '../workspace-aliases.js';

// #290: the docs-site vite config aliases framework subpaths to workspace
// `src/`; a subpath missing from the list resolves to `dist/`, which workerd
// refuses, killing dev. The alias list is generated from each package's
// `exports` map, so these tests pin the three properties dev correctness
// depends on: completeness (every export gets an alias), ordering (longest
// find first, so a subpath alias wins over the bare-package alias), and the
// dist->src / .js->.ts derivation.

const here = dirname(fileURLToPath(import.meta.url));
const packageDirs = ['hono-preact', 'iso', 'server'].map((name) =>
  resolve(here, '../../../../packages', name)
);

function readPkg(dir: string): {
  name: string;
  exports: Record<string, unknown>;
} {
  return JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
}

describe('workspaceAliases (#290)', () => {
  const aliases = workspaceAliases(packageDirs);
  const finds = aliases.map((a) => a.find);

  it('yields an alias whose find matches for every exports key', () => {
    for (const dir of packageDirs) {
      const pkg = readPkg(dir);
      for (const subpath of Object.keys(pkg.exports)) {
        const expectedFind =
          subpath === '.' ? pkg.name : pkg.name + subpath.slice(1);
        expect(finds).toContain(expectedFind);
      }
    }
    // The two subpaths that #290 previously had to hand-add and which regress
    // dev if dropped.
    expect(finds).toContain('hono-preact/page');
    expect(finds).toContain('@hono-preact/iso/page');
  });

  it('is sorted longest-find first', () => {
    const lengths = finds.map((f) => f.length);
    const sortedDescending = [...lengths].sort((a, b) => b - a);
    expect(lengths).toEqual(sortedDescending);
  });

  it('derives src/*.ts replacements from dist/*.js targets', () => {
    for (const a of aliases) {
      expect(a.replacement).not.toContain('/dist/');
      expect(a.replacement.endsWith('.js')).toBe(false);
      expect(a.replacement.endsWith('.ts')).toBe(true);
    }
    const bare = aliases.find((a) => a.find === 'hono-preact');
    expect(bare?.replacement).toMatch(/packages\/hono-preact\/src\/index\.ts$/);
    const isoPage = aliases.find((a) => a.find === '@hono-preact/iso/page');
    expect(isoPage?.replacement).toMatch(/packages\/iso\/src\/page-only\.ts$/);
  });

  it('points every alias at a src file that exists on disk', () => {
    // The derivation assumes the dist `import` target maps 1:1 onto a `src`
    // `.ts` sibling (`/dist/`->`/src/`, `.js`->`.ts`). If a package's src
    // basename ever diverges from its dist basename, the shape assertions above
    // still pass but the alias points at nothing, and the breakage only shows
    // up at dev/build time. Assert the derived file is real.
    expect(aliases.length).toBeGreaterThan(0);
    for (const a of aliases) {
      expect(existsSync(a.replacement), a.find + ' -> ' + a.replacement).toBe(
        true
      );
    }
  });
});
