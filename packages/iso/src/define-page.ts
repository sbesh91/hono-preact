import type { ComponentType } from 'preact';
import type { LoaderRef } from './define-loader.js';
import type { LoaderCache } from './cache.js';
import type { WrapperProps } from './page.js';

export type PageBindings<T> = {
  loader?: LoaderRef<T>;
  cache?: LoaderCache<T>;
  Wrapper?: ComponentType<WrapperProps>;
};

// Symbol.for so duplicate module copies (HMR, pnpm phantom deps) still match.
export const PAGE_BINDINGS = Symbol.for('@hono-preact/iso/page-bindings');

export type PageComponent<T> = ComponentType & {
  [PAGE_BINDINGS]?: PageBindings<T>;
};

export function definePage<T>(
  Component: ComponentType,
  bindings?: PageBindings<T>
): PageComponent<T> {
  if (bindings) {
    (Component as PageComponent<T>)[PAGE_BINDINGS] = bindings;
  }
  return Component as PageComponent<T>;
}
