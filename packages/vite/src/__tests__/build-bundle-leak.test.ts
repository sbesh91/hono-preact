import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures/leak-test');

function readAllFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...readAllFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

describe('client bundle does not leak server-only sources', () => {
  it('blocks the server module body even when imported transitively through a non-.server.ts re-export', async () => {
    // Fixture has TWO chains importing the same `.server.ts` module:
    //   1. iso.tsx → foo.server.ts        (direct)
    //   2. iso.tsx → wrapper.ts → foo.server.ts   (indirect; the test for #7)
    // The serverOnlyPlugin rewrites every import of a `.server.*` path
    // regardless of which file the import lives in, so chain #2 must also
    // strip the module body. If a future regression made the rewrite
    // direct-only, the sentinel would surface here.
    await build({
      root: fixtureDir,
      logLevel: 'error',
      configFile: resolve(fixtureDir, 'vite.config.ts'),
      build: {
        outDir: resolve(fixtureDir, 'dist'),
        emptyOutDir: true,
      },
    });

    const distFiles = readAllFilesRecursive(resolve(fixtureDir, 'dist'));
    const offending: string[] = [];
    for (const f of distFiles) {
      const content = readFileSync(f, 'utf8');
      if (content.includes('sentinel-must-not-leak-XYZ123')) {
        offending.push(f);
      }
    }
    expect(
      offending,
      `Server-only sentinel found in: ${offending.join(', ')}`
    ).toEqual([]);
  }, 60_000);
});
