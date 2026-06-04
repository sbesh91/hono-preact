import { Dialog } from '@hono-preact/ui';

// A minimal, unstyled-by-default Dialog used as the live demo on the docs
// page. The page's copyable CSS/Tailwind examples supply the visual styling.
export function DialogDemo() {
  return (
    <Dialog.Root>
      <Dialog.Trigger class="docs-dialog-trigger">Open dialog</Dialog.Trigger>
      <Dialog.Popup class="docs-dialog">
        <Dialog.Title>Subscribe</Dialog.Title>
        <Dialog.Description>
          Get notified when we ship something new.
        </Dialog.Description>
        <div class="docs-dialog__actions">
          <Dialog.Close class="docs-dialog-trigger">Close</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
