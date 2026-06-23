import { Popover } from 'hono-preact-ui';

// Live demo of Popover's `viewTransition` mode: the popup morphs out of the
// trigger and back using the View Transitions API instead of the data-state CSS
// enter/exit. The `.vt-popover` styles in apps/site/src/styles/root.css style
// only the resting popup (no @starting-style / data-state=closed keyframes); the
// snapshot tween supplies the motion. The string value names the popup's
// transition group (`vt-popover-panel`) so root.css can give it a z-index above
// the page chrome. Where View Transitions are unsupported, or under
// prefers-reduced-motion, it opens and closes instantly.
export function PopoverVTDemo() {
  return (
    <Popover.Root viewTransition="vt-popover-panel">
      <Popover.Trigger class="docs-popover-trigger">
        Open popover (morph)
      </Popover.Trigger>
      <Popover.Positioner class="vt-popover-positioner">
        <Popover.Popup class="vt-popover" aria-label="Account">
          <Popover.Title class="vt-popover__title">Signed in</Popover.Title>
          <Popover.Description class="vt-popover__desc">
            This popup grew out of the button using a View Transition.
          </Popover.Description>
          <Popover.Close class="docs-popover-close">Done</Popover.Close>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Root>
  );
}
