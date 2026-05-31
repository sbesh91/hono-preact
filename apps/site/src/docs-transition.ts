// Docs pages use a calm fade + subtle zoom instead of the global directional
// page slide. We emit the `docs` view-transition type for any navigation that
// enters, leaves, or moves within /docs, so root.css can override the slide for
// those navigations (see `:active-view-transition-type(docs)` there).
//
// Why a global subscriber and not a useViewTransitionTypes hook in DocsLayout:
// a layout hook only reliably catches docs->docs navigation. It is not
// subscribed yet when you navigate INTO docs (its effect runs a tick after the
// transition reads its types), and it is already torn down when you navigate
// OUT. A single subscriber registered once at client startup is the only place
// that sees every navigation's `from` and `to`, so it covers enter/leave/within
// uniformly.
//
// __subscribePhase is the framework's escape-hatch export; a public
// `subscribeViewTransitionTypes(fn)` would be the cleaner long-term home for a
// global, route-aware type rule like this.
import { __subscribePhase } from 'hono-preact/internal';

function isDocsPath(p: string | undefined): boolean {
  return p === '/docs' || (p?.startsWith('/docs/') ?? false);
}

// Client only: there is no view-transition pipeline (or document) during SSR,
// and routes.ts — which side-effect-imports this module — also runs on the
// server.
if (typeof document !== 'undefined') {
  __subscribePhase('beforeTransition', (event) => {
    const toDocs = isDocsPath(event.to);
    const fromDocs = isDocsPath(event.from);
    // `docs` drives the content fade + zoom for any navigation touching /docs.
    if (toDocs || fromDocs) event.types.push('docs');
    // `docs-within` marks the case where the sidebar is present in BOTH
    // snapshots and should stay frozen. Entering or leaving docs it is captured
    // on only one side, where freezing it would leave the old sidebar stuck on
    // screen for the transition — there it falls back to the default fade.
    if (toDocs && fromDocs) event.types.push('docs-within');
  });
}
