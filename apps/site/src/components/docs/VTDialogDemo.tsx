import { Dialog } from 'hono-preact-ui';

// Live demo of Dialog's `viewTransition` mode: the panel morphs out of the
// trigger and back using the View Transitions API instead of the data-state CSS
// enter/exit. The `.vt-dialog` styles in apps/site/src/styles/root.css style
// only the resting panel (no @starting-style / data-state=closed keyframes); the
// snapshot tween supplies the motion. The string value names the panel's
// transition group (`vt-dialog-panel`) so root.css can give it a z-index above
// the backdrop. Where View Transitions are unsupported, or under
// prefers-reduced-motion, it opens and closes instantly.
export function VTDialogDemo() {
  return (
    <Dialog.Root viewTransition="vt-dialog-panel">
      <Dialog.Trigger class="docs-dialog-trigger">
        Open dialog (morph)
      </Dialog.Trigger>
      <Dialog.Popup class="vt-dialog">
        <Dialog.Title>Subscribe</Dialog.Title>
        <Dialog.Description>
          This panel grew out of the button using a View Transition.
        </Dialog.Description>
        <div class="docs-dialog__actions">
          <Dialog.Close class="docs-dialog-close">Close</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
