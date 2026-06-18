import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';

// Arg passed to the optional tablist accessory (e.g. a copy button) so it can
// react to which panel is showing and read its text.
export interface TabsAccessoryArgs {
  active: number;
  getActiveText: () => string;
}

interface TabsProps {
  // One label per panel, in order.
  labels: string[];
  // The panels, one per label (in docs these are fenced code blocks or demos).
  children: ComponentChildren;
  // Rendered at the end of the tablist.
  accessory?: (args: TabsAccessoryArgs) => ComponentChildren;
  // Class on the outer container (callers supply card styling).
  class?: string;
}

// Accessible tab strip: roving tabindex, arrow/Home/End navigation, and all
// panels rendered with inactive ones hidden (so SSR content is present and the
// active panel never remounts on switch). The shared primitive behind CodeTabs
// and the Demo|Code tabs in Example.
export function Tabs({
  labels,
  children,
  accessory,
  class: className,
}: TabsProps) {
  const panels = toChildArray(children).filter(
    (c): c is VNode => typeof c === 'object'
  );
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);

  const getActiveText = () => panelRefs.current[active]?.textContent ?? '';

  const onKeyDown = (e: KeyboardEvent) => {
    const last = labels.length - 1;
    let next = active;
    if (e.key === 'ArrowRight') next = active === last ? 0 : active + 1;
    else if (e.key === 'ArrowLeft') next = active === 0 ? last : active - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div class={className}>
      <div class="docs-tabs__tablist" role="tablist" onKeyDown={onKeyDown}>
        {labels.map((label, i) => (
          <button
            key={label}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${i}`}
            aria-selected={i === active ? 'true' : 'false'}
            aria-controls={`${baseId}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            class="docs-tabs__tab"
            onClick={() => setActive(i)}
          >
            {label}
          </button>
        ))}
        {accessory?.({ active, getActiveText })}
      </div>
      {panels.map((panel, i) => (
        <div
          key={labels[i]}
          ref={(el) => {
            panelRefs.current[i] = el;
          }}
          role="tabpanel"
          id={`${baseId}-panel-${i}`}
          aria-labelledby={`${baseId}-tab-${i}`}
          hidden={i !== active}
          class="docs-tabs__panel"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
