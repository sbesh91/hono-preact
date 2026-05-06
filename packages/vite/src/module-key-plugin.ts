import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { deriveModuleKey } from './module-key.js';

/**
 * Transforms `.server.*` files to inject a stable module-level
 * `__moduleKey` export (and to thread that key into `defineLoader` calls).
 * The key is path-derived (see `deriveModuleKey`), so it survives builds
 * and HMR, and is unique per file.
 *
 * Pairs with `serverOnlyPlugin`, which transforms client-side imports of
 * `.server.*` files. Both plugins compute the same key from the same
 * absolute path + viteRoot.
 */
export function moduleKeyPlugin(): Plugin {
  let viteRoot: string | undefined;
  return {
    name: 'module-key',
    enforce: 'pre',
    configResolved(config) {
      viteRoot = config.root;
    },
    transform(code: string, id: string) {
      if (viteRoot === undefined) return;
      if (!/\.server\.[jt]sx?$/.test(id)) return;
      if (!id.startsWith(viteRoot)) return;

      const key = deriveModuleKey(id, viteRoot);
      const s = new MagicString(code);
      s.prepend(`export const __moduleKey = ${JSON.stringify(key)};\n`);
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
