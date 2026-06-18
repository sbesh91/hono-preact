import { Tooltip } from 'hono-preact-ui';

interface TooltipExampleProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export function TooltipExample({
  side = 'top',
  align = 'center',
}: TooltipExampleProps) {
  return (
    <Tooltip.Root side={side} align={align}>
      <Tooltip.Trigger class="docs-tooltip-trigger">Hover me</Tooltip.Trigger>
      <Tooltip.Positioner class="docs-tooltip-positioner">
        <Tooltip.Popup class="docs-tooltip">
          <Tooltip.Arrow class="docs-tooltip__arrow" />
          Saved to your library
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}
