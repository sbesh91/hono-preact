import path from 'node:path';
import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:hono-preact/client-shim';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/**
 * Defines a minimal `process` object on the global so libraries that read
 * `process.env.NODE_ENV` at module-evaluation time in the browser do not
 * throw a `ReferenceError`. The shim is `??=` so it never clobbers an
 * existing `process` (other shims, polyfills, runtime injection).
 *
 * Mounted by transforming the configured client entry to prepend an import
 * of a virtual module that carries the shim source. This guarantees the
 * shim runs first regardless of the order of the user's other imports.
 */
export function clientShimPlugin(clientEntry: string): Plugin {
  let resolvedEntry: string | null = null;
  let shimSource = '';

  return {
    name: 'hono-preact:client-shim',
    enforce: 'pre',
    apply(_, { command, mode }) {
      // Inject during dev (`vite serve`) and the client build only. The SSR
      // build runs in Node/Workers and does not need the shim.
      return command === 'serve' || (command === 'build' && mode === 'client');
    },
    configResolved(config) {
      resolvedEntry = path.resolve(config.root, clientEntry);
      const nodeEnv = config.isProduction ? 'production' : 'development';
      shimSource = `globalThis.process ??= { env: { NODE_ENV: ${JSON.stringify(nodeEnv)} } };\n`;
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) return shimSource;
    },
    transform(code, id) {
      if (resolvedEntry === null) return;
      // Virtual client entry: matches the resolved virtual id directly. The
      // configured `clientEntry` carries the unresolved `virtual:` form, which
      // we mirror here so the shim still injects.
      if (clientEntry.startsWith('virtual:') && id === '\0' + clientEntry) {
        return {
          code: `import '${VIRTUAL_ID}';\n${code}`,
          map: null,
        };
      }
      // Disk-based entry: equal, or `<entry>?<query>`.
      if (!id.startsWith(resolvedEntry)) return;
      const tail = id.length - resolvedEntry.length;
      if (tail !== 0 && id.charCodeAt(resolvedEntry.length) !== 63 /* '?' */)
        return;
      return {
        code: `import '${VIRTUAL_ID}';\n${code}`,
        map: null,
      };
    },
  };
}
