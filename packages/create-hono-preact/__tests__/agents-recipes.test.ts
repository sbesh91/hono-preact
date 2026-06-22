import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = resolve(here, '..', 'templates', 'agents');

describe('bundled docs corpus', () => {
  it('is present and non-trivial (run `pnpm gen:agents-corpus`)', () => {
    const corpus = resolve(agentsDir, 'llms-full.txt');
    expect(existsSync(corpus), `${corpus} missing`).toBe(true);
    expect(readFileSync(corpus, 'utf8').length).toBeGreaterThan(1000);
  });
});
