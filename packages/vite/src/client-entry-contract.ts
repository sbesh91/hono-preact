import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-time guard for the custom `clientEntry` contract. The framework's
 * virtual entry calls bootClient() before hydrating; a hand-written entry
 * that skips it silently loses view transitions, history direction
 * tracking, and live-loader stream wiring. When the configured entry is a
 * disk module (not the framework virtual), warn once in dev if its source
 * never references bootClient.
 *
 * The check is a reference scan, not a call-graph proof: an entry that
 * imports bootClient but never calls it slips through. That trade keeps the
 * guard a one-regex transform, and the import-without-call case is far
 * rarer than the forgot-entirely case this exists to catch.
 */
export function clientEntryContractPlugin(clientEntry: string): Plugin {
  let resolvedEntry: string | null = null;
  let isDev = false;
  let warned = false;

  return {
    name: 'hono-preact:client-entry-contract',
    // The framework's own virtual entry always boots correctly; only a
    // disk-based override needs the guard.
    apply: () => !clientEntry.startsWith('virtual:'),
    configResolved(config) {
      resolvedEntry = path.resolve(config.root, clientEntry);
      isDev = config.command === 'serve';
    },
    transform(code, id) {
      if (!isDev || warned || resolvedEntry === null) return;
      // Entry module id: equal to the resolved entry, or `<entry>?<query>`
      // (the same matching clientShimPlugin uses).
      if (!id.startsWith(resolvedEntry)) return;
      const tail = id.length - resolvedEntry.length;
      if (tail !== 0 && id.charCodeAt(resolvedEntry.length) !== 63 /* '?' */)
        return;
      if (/\bbootClient\b/.test(code)) return;
      warned = true;
      this.warn(
        `[hono-preact] custom clientEntry ${JSON.stringify(clientEntry)} never references ` +
          `bootClient(). Import it from 'hono-preact' and call it before hydrate(), or ` +
          `view transitions, history direction tracking, and live-loader streams will ` +
          `silently not work.`
      );
    },
  };
}
