import { Popover } from 'hono-preact-ui';

interface PopoverExampleProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export function PopoverExample({
  side = 'bottom',
  align = 'center',
}: PopoverExampleProps) {
  return (
    <Popover.Root side={side} align={align}>
      <Popover.Trigger class="docs-popover-trigger">
        Open popover
      </Popover.Trigger>
      <Popover.Positioner class="docs-popover-positioner">
        <Popover.Popup class="docs-popover">
          <Popover.Arrow class="docs-popover__arrow" />
          <Popover.Title class="docs-popover__title">Settings</Popover.Title>
          <Popover.Description class="docs-popover__desc">
            Adjust your preferences.
          </Popover.Description>
          <Popover.Close class="docs-popover-close">Done</Popover.Close>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Root>
  );
}
