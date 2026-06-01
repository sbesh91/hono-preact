// Docs pages use a calm fade + subtle zoom instead of the global directional
// page slide. We emit the `docs` view-transition type for any navigation that
// enters, leaves, or moves within /docs, so root.css can override the slide for
// those navigations (see `:active-view-transition-type(docs)` there).
//
// This is a single always-on subscriber rather than a useViewTransitionTypes
// hook in DocsLayout: a layout hook only reliably catches docs->docs navigation.
// It is not subscribed yet when you navigate INTO docs (its effect runs a tick
// after the transition reads its types), and it is already torn down when you
// navigate OUT. A subscriber registered once at client startup is the only place
// that sees every navigation's `from` and `to`, so it covers enter/leave/within
// uniformly. subscribeViewTransitionTypes no-ops on the server, so the
// side-effect import from routes.ts (which also runs server-side) is safe.
import { subscribeViewTransitionTypes } from 'hono-preact';

function isDocsPath(p: string | undefined): boolean {
  return p === '/docs' || (p?.startsWith('/docs/') ?? false);
}

subscribeViewTransitionTypes((nav) => {
  const toDocs = isDocsPath(nav.to);
  const fromDocs = isDocsPath(nav.from);
  const types: string[] = [];
  // `docs` drives the content fade + zoom for any navigation touching /docs.
  if (toDocs || fromDocs) types.push('docs');
  // `docs-within` marks the case where the sidebar is present in BOTH snapshots
  // and should stay frozen. Entering or leaving docs it is captured on only one
  // side, where freezing it would leave the old sidebar stuck on screen for the
  // transition, so there it falls back to the default fade.
  if (toDocs && fromDocs) types.push('docs-within');
  return types;
});
