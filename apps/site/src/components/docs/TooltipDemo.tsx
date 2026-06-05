import { Tooltip } from '@hono-preact/ui';

// Styled Tooltip used as the live demo. The styling lives in
// apps/site/src/styles/root.css (.docs-tooltip*) and mirrors the copyable CSS
// example on the docs page.
export function TooltipDemo() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger class="docs-tooltip-trigger">Hover me</Tooltip.Trigger>
      <Tooltip.Positioner class="docs-tooltip-positioner">
        <Tooltip.Popup class="docs-tooltip">
          Saved to your library
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}
