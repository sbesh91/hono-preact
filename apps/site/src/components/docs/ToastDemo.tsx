import { toast, Toaster, Toast, type ToastRecord } from 'hono-preact-ui';

function renderToast(t: ToastRecord) {
  return (
    <Toast.Root toast={t} class="docs-toast">
      <div class="docs-toast-body">
        <Toast.Title class="docs-toast-title" />
        <Toast.Description class="docs-toast-description" />
      </div>
      <Toast.Action class="docs-toast-action" />
      <Toast.Close class="docs-toast-close" aria-label="Dismiss">
        x
      </Toast.Close>
    </Toast.Root>
  );
}

export default function ToastDemo() {
  return (
    <div class="docs-toast-demo">
      <div class="docs-toast-controls">
        <button class="docs-button" onClick={() => toast('Event saved')}>
          Default
        </button>
        <button
          class="docs-button"
          onClick={() =>
            toast.success('Profile updated', {
              description: 'Your changes are live.',
            })
          }
        >
          Success
        </button>
        <button
          class="docs-button"
          onClick={() =>
            toast.error('Upload failed', {
              action: { label: 'Retry', onClick: () => toast('Retrying...') },
            })
          }
        >
          Error + action
        </button>
        <button
          class="docs-button"
          onClick={() =>
            toast.promise(
              new Promise((res) => setTimeout(res, 1500)),
              {
                loading: 'Saving...',
                success: 'Saved!',
                error: 'Could not save',
              },
            )
          }
        >
          Promise
        </button>
      </div>
      <Toaster position="bottom-right">{renderToast}</Toaster>
    </div>
  );
}
