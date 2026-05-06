import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';
import { serverOnlyPlugin } from '../server-only.js';
import type { Plugin } from 'vite';

const ROOT = '/Users/me/repo';

function makePlugins() {
  const m = moduleKeyPlugin() as Plugin & {
    configResolved?: (c: { root: string }) => void;
    transform: (code: string, id: string) => { code: string } | undefined;
  };
  const s = serverOnlyPlugin() as Plugin & {
    configResolved?: (c: { root: string }) => void;
    transform: (
      code: string,
      id: string,
      options?: { ssr?: boolean }
    ) => { code: string } | undefined;
  };
  m.configResolved?.({ root: ROOT });
  s.configResolved?.({ root: ROOT });
  return { m, s };
}

describe('path-key parity across moduleKeyPlugin and serverOnlyPlugin', () => {
  it('uses the same key for the .server.* file and its client-side import', () => {
    const { m, s } = makePlugins();

    // Server side: moduleKeyPlugin transforms the .server.ts file.
    const serverCode = [
      `import { defineLoader } from '@hono-preact/iso';`,
      `export default async () => ({});`,
      `export const loader = defineLoader(async () => ({}));`,
    ].join('\n');
    const serverResult = m.transform.call(
      {} as any,
      serverCode,
      `${ROOT}/src/pages/movies.server.ts`
    );
    expect(serverResult?.code).toMatch(
      /^export const __moduleKey = "src\/pages\/movies";/
    );

    // Client side: serverOnlyPlugin transforms a consumer that imports
    // the same file.
    const clientCode = `import { loader } from './movies.server.js';`;
    const clientResult = s.transform.call(
      {} as any,
      clientCode,
      `${ROOT}/src/pages/movies.tsx`
    );
    expect(clientResult?.code).toContain(
      `Symbol.for('@hono-preact/loader:src/pages/movies')`
    );
  });

  it('derives distinct keys for cross-folder same-basename collisions', () => {
    const { m } = makePlugins();
    const aResult = m.transform.call(
      {} as any,
      `export default async () => ({});`,
      `${ROOT}/src/pages/movies.server.ts`
    );
    const bResult = m.transform.call(
      {} as any,
      `export default async () => ({});`,
      `${ROOT}/src/pages/admin/movies.server.ts`
    );
    expect(aResult?.code).toContain('"src/pages/movies"');
    expect(bResult?.code).toContain('"src/pages/admin/movies"');
  });
});
