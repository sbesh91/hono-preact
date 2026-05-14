import { describe, it, expect } from 'vitest';
import { build, type InlineConfig, type Rollup } from 'vite';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { guardStripPlugin } from '../guard-strip.js';

const fixtureDir = path.dirname(
  fileURLToPath(new URL('./fixtures/guards-treeshake/src/page.tsx', import.meta.url)),
);

async function bundleFor(ssr: boolean): Promise<string> {
  const config: InlineConfig = {
    root: fixtureDir,
    logLevel: 'error',
    configFile: false,
    plugins: [guardStripPlugin()],
    build: {
      write: false,
      ssr: ssr || undefined,
      rollupOptions: {
        input: path.join(fixtureDir, 'page.tsx'),
        external: ['@hono-preact/iso', '@hono-preact/iso/internal'],
      },
      minify: false,
      target: 'esnext',
    },
  };
  const out = (await build(config)) as Rollup.RollupOutput;
  const chunks = Array.isArray(out) ? out : [out];
  const chunk = chunks[0].output.find((o: { type: string }) => o.type === 'chunk') as Rollup.OutputChunk;
  return chunk.code;
}

describe('guards tree-shake', () => {
  it('client bundle does NOT contain the server-only marker', async () => {
    const code = await bundleFor(false);
    expect(code).not.toContain('BUNDLE_MARKER_SERVER_TOKEN_VALUE');
  });

  it('client bundle DOES contain the client-only marker', async () => {
    const code = await bundleFor(false);
    expect(code).toContain('BUNDLE_MARKER_CLIENT_USER_KEY_VALUE');
  });

  it('server bundle does NOT contain the client-only marker', async () => {
    const code = await bundleFor(true);
    expect(code).not.toContain('BUNDLE_MARKER_CLIENT_USER_KEY_VALUE');
  });

  it('server bundle DOES contain the server-only marker', async () => {
    const code = await bundleFor(true);
    expect(code).toContain('BUNDLE_MARKER_SERVER_TOKEN_VALUE');
  });
});
