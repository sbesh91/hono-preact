import { defineServerMiddleware } from 'hono-preact';
import { deny, render, type Outcome } from 'hono-preact/page';
import { getProjectBySlug } from './data.js';
import { ArchivedProjectNotice } from '../components/demo/ArchivedProjectNotice.js';

// The scope-branching logic, extracted so unit tests can drive it directly:
// a hand-built ServerCtx can't structurally satisfy Hono's Context (private
// fields make it effectively nominal, same issue project-board.server.ts's
// timeLoader works around), so this helper takes just the two primitives the
// gate actually needs (the scope and the route's projectId) instead of the
// full ctx. render() is a page-scope-only outcome (it swaps the page tree),
// so the loader scope denies 410 instead: a client-side nav to an archived
// project surfaces the message through the board View's errorFallback, while
// a full reload gets the swapped notice page. Actions pass through (no
// location on that scope; the archived board is unreachable through the UI
// anyway).
export function archivedOutcomeFor(
  scope: 'page' | 'loader' | 'action',
  projectId: string | undefined
): Outcome | undefined {
  if (scope === 'action') return undefined;
  const project = projectId ? getProjectBySlug(projectId) : null;
  if (!project?.archived) return undefined;
  return scope === 'page'
    ? render(ArchivedProjectNotice)
    : deny(410, 'This project is archived and read-only.');
}

// Declared as `use` on the /demo/projects/:projectId route node, so it runs
// for the page render AND every loader RPC under that node.
export const archivedGateServer = defineServerMiddleware(async (ctx, next) => {
  const outcome =
    ctx.scope === 'action'
      ? undefined
      : archivedOutcomeFor(ctx.scope, ctx.location.pathParams.projectId);
  if (outcome) return outcome;
  await next();
});

export const archivedGate = [archivedGateServer];
