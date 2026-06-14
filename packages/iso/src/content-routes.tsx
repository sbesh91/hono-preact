import { h } from 'preact';
import type { ComponentChildren, ComponentType } from 'preact';
import type { RouteDef, ViewProps } from './define-routes.js';

export interface ContentRoutesOptions {
  /**
   * Single-element wrapper around each content module's default export.
   * Load-bearing: it provides the single DOM root that keeps a Fragment-root
   * module (e.g. compiled MDX) from double-rendering during hydration inside
   * preact-iso's lazy + Suspense. It must render a single root element, so it
   * cannot be a Fragment. Defaults to a bare `<div>`.
   */
  wrapper?: ComponentType<{ children: ComponentChildren }>;
  /**
   * Map a glob key to a route slug (the child `path`). Overrides the default
   * rule entirely. Receives the raw glob key (relative to the file that called
   * `import.meta.glob`).
   */
  slug?: (key: string) => string;
  /**
   * Prefix stripped from each key before deriving the slug. Defaults to the
   * longest common directory prefix shared by all keys. Ignored when `slug`
   * is provided.
   */
  base?: string;
}

const DefaultWrapper: ComponentType<{ children: ComponentChildren }> = ({
  children,
}) => h('div', null, children);

// Longest common DIRECTORY prefix of the keys: the char-level common prefix
// truncated at its last '/', so only whole leading directory segments are
// stripped. A single-key map yields that key's directory. When every key
// shares a deeper directory, pass `base` explicitly to control the depth.
function commonDirPrefix(keys: readonly string[]): string {
  if (keys.length === 0) return '';
  let prefix = keys[0];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    let j = 0;
    while (j < prefix.length && j < k.length && prefix[j] === k[j]) j++;
    prefix = prefix.slice(0, j);
    if (prefix === '') break;
  }
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash === -1 ? '' : prefix.slice(0, lastSlash + 1);
}

// Default slug rule: strip the base prefix, the final extension, and a
// trailing `index` segment (so `index` -> '' and `dir/index` -> 'dir').
function defaultSlug(key: string, base: string): string {
  let s = key.startsWith(base) ? key.slice(base.length) : key;
  s = s.replace(/\.[^./]+$/, '');
  s = s.replace(/(^|\/)index$/, '');
  return s;
}

/**
 * Turn a Vite `import.meta.glob` module map into framework route nodes, one per
 * file. Each node's `view` loads the module and renders its default export
 * inside a single-element `wrapper` (the hydration-safe root). Spread the
 * result into a route tree, typically under a `layout` group.
 *
 * `import.meta.glob` must be written inline with a literal pattern (a Vite
 * requirement), so the caller passes the resolved map in.
 */
export function contentRoutes(
  modules: Record<string, () => Promise<unknown>>,
  options: ContentRoutesOptions = {}
): RouteDef[] {
  const Wrapper = options.wrapper ?? DefaultWrapper;
  const keys = Object.keys(modules);
  const base = options.base ?? commonDirPrefix(keys);
  const toSlug = options.slug ?? ((key: string) => defaultSlug(key, base));

  return keys.map((key) => {
    const load = modules[key];
    const view = () =>
      load().then((mod) => {
        // Structural read off a user-defined module export (acceptable cast
        // boundary): the glob value's `default` is the page component.
        const Content = (mod as { default: ComponentType<ViewProps> }).default;
        const WrappedView: ComponentType<ViewProps> = (props) =>
          h(Wrapper, null, h(Content, props));
        return { default: WrappedView };
      });
    return { path: toSlug(key), view };
  });
}
