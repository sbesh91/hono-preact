// @hono-preact/iso/page -- page-scope outcome kitchen sink.
//
// This subpath bundles every outcome a page-scope server middleware
// reaches for in one import. `render` is the page-scope-only constructor
// (loaders/actions can't replace the page tree), so it lives here and
// nowhere else; the docs steer users at this subpath when they need it.
// `redirect`/`deny` and the predicates (`isOutcome`/`isRedirect`/`isDeny`
// /`isRender`) are re-exported here too so a page-scope file can write a
// single `import { redirect, deny, render } from 'hono-preact/page'` line.
//
// Canonical export location for the cross-scope symbols is `./outcomes.js`.
// Both this subpath and `./index.js` re-export from there; nothing here
// hides surface. The predicates are scope-agnostic, so `index.ts` is their
// primary home for consumers that don't already need the page-scope
// subpath; the predicates are duplicated here only for the kitchen-sink
// import path.

import type { FunctionComponent } from 'preact';
import type { RenderOutcome } from './outcomes.js';

export {
  redirect,
  deny,
  isOutcome,
  isRedirect,
  isDeny,
  isRender,
} from './outcomes.js';

export type {
  Outcome,
  RedirectOutcome,
  DenyOutcome,
  RenderOutcome,
  RedirectStatusCode,
  ErrorStatusCode,
} from './outcomes.js';

export function render(Component: FunctionComponent): RenderOutcome {
  return { __outcome: 'render', Component };
}
