import type { ComponentChildren } from 'preact';
import { Tabs } from './Tabs.js';
import { CopyButton } from './CopyButton.js';

interface ExampleProps {
  children: ComponentChildren;
  // Build-time highlighted HTML of the source that powers this demo, imported
  // via `'./FooDemo.tsx?highlighted'`. When present, the demo is shown in a
  // Demo|Code tab strip; when absent, just the bordered demo frame.
  code?: string;
}

// Hosts a live component demo on a docs page. With `code`, shows Demo|Code tabs
// (the Code tab is the real source that renders the demo, so it cannot drift).
export function Example({ children, code }: ExampleProps) {
  if (code == null) {
    return <div class="docs-example">{children}</div>;
  }
  return (
    <Tabs
      class="docs-tabs docs-example-tabs"
      labels={['Demo', 'Code']}
      accessory={({ active, getActiveText }) =>
        // Copy applies to the Code panel only (index 1).
        active === 1 ? (
          <CopyButton class="docs-tabs__copy" getText={getActiveText} />
        ) : null
      }
    >
      <div class="docs-example-tabs__demo">{children}</div>
      <div
        class="docs-example-tabs__code"
        // Trusted: our own files, highlighted at build time.
        dangerouslySetInnerHTML={{ __html: code }}
      />
    </Tabs>
  );
}
