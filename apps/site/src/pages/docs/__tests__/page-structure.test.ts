import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePageStructure } from '../../../../scripts/docs-structure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    if (e.isDirectory() && e.name !== '__tests__') return walk(p);
    return e.isFile() && e.name.endsWith('.mdx') && e.name !== 'index.mdx'
      ? [p]
      : [];
  });
}

describe('every docs page follows the canonical structure', () => {
  for (const file of walk(docsDir)) {
    const rel = relative(docsDir, file);
    it(`${rel}: canonical order (R1/R2/R3)`, () => {
      const problems = analyzePageStructure(readFileSync(file, 'utf8'));
      expect(
        problems,
        problems.map((p) => `${p.rule} ${p.message}`).join('; ')
      ).toEqual([]);
    });
  }
});
