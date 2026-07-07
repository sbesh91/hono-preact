import { useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

// A lazily-imported nested layout wrapping the view. Chaining a second lazy
// chunk boundary (layout -> view) between the router match and the rendered
// leaf gives the async prerender an extra await during which the dep
// optimizer's discovery of `zod` (imported only from the view, see
// late-view.tsx) could race the in-flight render, mirroring the real
// DocsLayout shape (layout + children).
export default function LateLayout({
  children,
}: {
  children: ComponentChildren;
}) {
  useEffect(() => {
    // No-op: exercises preact/hooks during the layout's own render, mirroring
    // the real DocsLayout's hook usage.
  }, []);
  return <div id="late-layout">{children}</div>;
}
