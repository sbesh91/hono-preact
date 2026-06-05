import { Popover } from '@hono-preact/ui';

// Styled Popover used as the live demo. The styling lives in
// apps/site/src/styles/root.css (.docs-popover*) and mirrors the copyable CSS
// example on the docs page, so what you see is what you copy.
export function PopoverDemo() {
  return (
    <Popover.Root>
      <Popover.Trigger class="docs-popover-trigger">
        Open popover
      </Popover.Trigger>
      <Popover.Positioner class="docs-popover-positioner">
        <Popover.Popup class="docs-popover">
          <Popover.Title class="docs-popover__title">Settings</Popover.Title>
          <Popover.Description class="docs-popover__desc">
            Adjust how the demo behaves.
          </Popover.Description>
          <Popover.Close class="docs-popover-close">Done</Popover.Close>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Root>
  );
}
