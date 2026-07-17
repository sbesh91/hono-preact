import type { LayoutProps } from 'hono-preact';
import { useViewTransitionTypes } from 'hono-preact';
import { Toast, Toaster, type ToastRecord } from 'hono-preact-ui';

// One Toaster for the whole demo subtree: toast() reaches it through the
// ui package's module singleton, so mounting it once here is the wiring.
// `class="demo-toaster"` positions the region (root.css); Toast.Root's own
// class positions and styles each item.
const renderDemoToast = (t: ToastRecord) => (
  <Toast.Root toast={t} class="demo-toast">
    <div class="min-w-0 flex-1">
      <Toast.Title class="text-sm font-semibold text-foreground" />
      <Toast.Description class="mt-0.5 text-xs text-muted" />
    </div>
    <Toast.Action class="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-foreground/5" />
    <Toast.Close
      aria-label="Dismiss notification"
      class="shrink-0 text-muted hover:text-foreground"
    >
      &times;
    </Toast.Close>
  </Toast.Root>
);

// Thin layout wrapping every /demo route. Its jobs are hosting the
// view-transition direction hook on a node that stays mounted across all demo
// navigations, and mounting the demo's single Toaster.
//
// In-app up-links (e.g. the project layout's "back to all projects") are pushState
// navigations, so the history shim classifies them as forward nav-push. We
// emit `nav-up` when the destination is an ancestor of the current path so the
// CSS plays the reverse (left-to-right) slide instead.
//
// This must live on a persistent parent: the route-change event dispatches
// after the new route commits, so a hook on the unmounting source layout
// (e.g. project-header.tsx, which is gone when you navigate up to the board) or
// on the just-mounted destination (which subscribes a tick too late) would miss
// the event. Only a layout mounted across the whole navigation catches it.
export default function DemoLayout({ children }: LayoutProps) {
  useViewTransitionTypes((nav) => {
    const types: string[] = [];
    if (nav.from && nav.from.startsWith(nav.to + '/')) types.push('nav-up');
    const fromProjects = nav.from?.startsWith('/demo/projects') ?? false;
    const toProjects = nav.to?.startsWith('/demo/projects') ?? false;
    if (fromProjects && toProjects) types.push('demo-within');
    return types;
  });
  return (
    <>
      {children}
      <Toaster
        class="demo-toaster"
        position="bottom-right"
        label="Demo notifications"
      >
        {renderDemoToast}
      </Toaster>
    </>
  );
}
