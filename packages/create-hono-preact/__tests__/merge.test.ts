import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepMerge, composePackageJson } from '../lib/template.mjs';

describe('deepMerge', () => {
  it('merges nested objects', () => {
    expect(
      deepMerge(
        { scripts: { dev: 'vite' }, dependencies: { preact: '^10' } },
        { scripts: { build: 'vite build' }, dependencies: { hono: '^4' } }
      )
    ).toEqual({
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { preact: '^10', hono: '^4' },
    });
  });

  it('replaces scalars and arrays from b', () => {
    expect(deepMerge({ a: 1, list: [1, 2] }, { a: 2, list: [3] })).toEqual({
      a: 2,
      list: [3],
    });
  });

  it('does not mutate either input', () => {
    const a = { scripts: { dev: 'vite' } };
    const b = { scripts: { build: 'x' } };
    deepMerge(a, b);
    expect(a).toEqual({ scripts: { dev: 'vite' } });
    expect(b).toEqual({ scripts: { build: 'x' } });
  });
});

describe('composePackageJson', () => {
  it('merges fragment files in order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chp-merge-'));
    try {
      writeFileSync(
        join(dir, 'base.json'),
        JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { preact: '^10' } })
      );
      writeFileSync(
        join(dir, 'overlay.json'),
        JSON.stringify({ scripts: { deploy: 'wrangler deploy' }, devDependencies: { wrangler: '^4' } })
      );
      const merged = await composePackageJson([
        join(dir, 'base.json'),
        join(dir, 'overlay.json'),
      ]);
      expect(merged).toEqual({
        scripts: { dev: 'vite', deploy: 'wrangler deploy' },
        dependencies: { preact: '^10' },
        devDependencies: { wrangler: '^4' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
