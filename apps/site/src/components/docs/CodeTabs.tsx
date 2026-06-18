import type { ComponentChildren } from 'preact';
import { Tabs } from './Tabs.js';
import { CopyButton } from './CopyButton.js';

interface CodeTabsProps {
  // One label per child code block, in order. The children are fenced code
  // blocks (```css, ```tsx, ...) so they are syntax-highlighted at build time
  // by the same Shiki pipeline as every other code sample on the docs site.
  labels: string[];
  children: ComponentChildren;
}

// Tabbed, copyable code examples. Built on the shared Tabs primitive; copies
// the active block's text (read from the DOM, so it copies the raw source
// rather than the highlighting markup).
export function CodeTabs({ labels, children }: CodeTabsProps) {
  return (
    <Tabs
      class="docs-tabs"
      labels={labels}
      accessory={({ getActiveText }) => (
        <CopyButton class="docs-tabs__copy" getText={getActiveText} />
      )}
    >
      {children}
    </Tabs>
  );
}
