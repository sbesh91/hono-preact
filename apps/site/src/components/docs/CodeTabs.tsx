import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { CopyButton } from './CopyButton.js';

interface CodeTabsProps {
  // One label per child code block, in order. The children are fenced code
  // blocks (```css, ```tsx, ...) so they are syntax-highlighted at build time
  // by the same Shiki pipeline as every other code sample on the docs site.
  labels: string[];
  children: ComponentChildren;
}

// Tabbed, copyable code examples. Shows one highlighted block at a time and
// copies the active block's text (read from the DOM, so it copies the raw
// source rather than the highlighting markup).
export function CodeTabs({ labels, children }: CodeTabsProps) {
  const panels = toChildArray(children).filter(
    (c): c is VNode => typeof c === 'object'
  );
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div class="docs-codetabs">
      <div class="docs-codetabs__tablist" role="tablist">
        {labels.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={i === active}
            class="docs-codetabs__tab"
            onClick={() => setActive(i)}
          >
            {label}
          </button>
        ))}
        <CopyButton
          class="docs-codetabs__copy"
          getText={() => panelRef.current?.textContent ?? ''}
        />
      </div>
      <div class="docs-codetabs__panel" ref={panelRef}>
        {panels[active]}
      </div>
    </div>
  );
}
