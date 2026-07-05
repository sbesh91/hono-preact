import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// The loader client entry (loader-runner) must not eagerly bundle the
// server-side direct-dispatch path (createCaller / dispatchServer /
// streaming-SSR registration). That path only ever runs during SSR; a browser
// loader route takes the RPC-fetch path. Bundling the client loader entry for
// the browser with code-splitting, the server branch must land in a SPLIT
// (dynamically-imported) chunk, never the eager entry chunk, so a loader route
// does not download server-only dispatch code it can never execute
// (REVIEW.md §5, "server stays off the client").
const SERVER_MARKER = 'ctx.c is not available'; // unique to the server branch

describe('loader-runner client/server split', () => {
  it('keeps the server dispatch path out of the eager loader entry chunk', async () => {
    const result = await build({
      entryPoints: [resolve('packages/iso/dist/internal/loader-runner.js')],
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      outdir: 'out',
      minify: false,
      external: ['preact', 'preact/*', 'preact-iso', 'hono', 'hono/*'],
      logLevel: 'silent',
    });

    const entry = result.outputFiles.find((f) =>
      f.path.endsWith('loader-runner.js')
    );
    expect(entry, 'loader-runner entry chunk should exist').toBeDefined();

    // The eager entry must NOT carry the server-only dispatch path.
    expect(entry!.text).not.toContain(SERVER_MARKER);

    // And it must not vanish: the server path lives in a split chunk (proof it
    // was code-split behind a dynamic import, not deleted).
    const splitCarriesServer = result.outputFiles.some(
      (f) =>
        !f.path.endsWith('loader-runner.js') && f.text.includes(SERVER_MARKER)
    );
    expect(splitCarriesServer, 'server path should be in a split chunk').toBe(
      true
    );
  });
});
