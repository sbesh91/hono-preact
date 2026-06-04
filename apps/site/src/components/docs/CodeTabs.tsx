import { useState } from 'preact/hooks';
import { CopyButton } from './CopyButton.js';

export interface CodeTab {
  label: string;
  code: string;
  language?: string;
}

interface CodeTabsProps {
  tabs: CodeTab[];
}

// Labeled code tabs with a per-tab Copy button. Used on docs pages to offer
// copyable styling in more than one flavor (e.g. CSS and Tailwind).
export function CodeTabs({ tabs }: CodeTabsProps) {
  const [active, setActive] = useState(0);
  const current = tabs[active];

  return (
    <div class="docs-codetabs">
      <div class="docs-codetabs__tablist" role="tablist">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={i === active}
            class="docs-codetabs__tab"
            onClick={() => setActive(i)}
          >
            {tab.label}
          </button>
        ))}
        <CopyButton text={current.code} class="docs-codetabs__copy" />
      </div>
      <pre class={`docs-codetabs__pre language-${current.language ?? 'text'}`}>
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
