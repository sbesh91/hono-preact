import { Dialog } from '@hono-preact/ui';

// A styled Dialog used as the live demo on the docs page. The styling lives in
// apps/site/src/styles/root.css (.docs-dialog*) and mirrors the copyable CSS
// example below it, so what you see is what you copy.
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
          <Dialog.Close class="docs-dialog-close">Close</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
