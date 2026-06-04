import type { ComponentChildren } from 'preact';

interface ExampleProps {
  children: ComponentChildren;
}

// A bordered frame that hosts a live component demo on a docs page.
export function Example({ children }: ExampleProps) {
  return <div class="docs-example">{children}</div>;
}
