import type { LayoutProps } from 'hono-preact';
import { useViewTransitionTypes } from 'hono-preact';

// Thin layout wrapping every /demo route. Its only job is to host the
// view-transition direction hook on a node that stays mounted across all demo
// navigations.
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
  return <>{children}</>;
}
