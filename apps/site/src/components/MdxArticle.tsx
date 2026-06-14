import type { ComponentChildren } from 'preact';

// Single-root wrapper for MDX content. The single element is what keeps a
// Fragment-root MDX module from double-rendering during hydration, and it is
// the docs prose styling container.
export function MdxArticle({ children }: { children: ComponentChildren }) {
  return <article class="mdx-content">{children}</article>;
}
