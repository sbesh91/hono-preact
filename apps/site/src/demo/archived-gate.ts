import { defineServerMiddleware } from 'hono-preact';
import { deny, render, type Outcome } from 'hono-preact/page';
import { getProjectBySlug } from './data.js';
import { ArchivedProjectNotice } from '../components/demo/ArchivedProjectNotice.js';

// The scope-branching logic, extracted so unit tests can drive it directly:
// a hand-built ServerCtx can't structurally satisfy Hono's Context (private
// fields make it effectively nominal, same issue project-board.server.ts's
// timeLoader works around), so this helper takes just the two primitives the
// gate actually needs (the scope and the route's projectId) instead of the
// full ctx. render() is a page-scope-only outcome (it swaps the page tree), so
// loader and action scope deny instead: a client-side nav to an archived
// project surfaces the message through the board View's errorFallback, a full
// reload gets the swapped notice page, and a mutation addressed to the
// archived project's URL is refused. A route-node guard now covers action
// scope because a route-bound action
// carries a route-authoritative location (#288); the task-detail actions are
// already route-bound and the board actions are bound below.
export function archivedOutcomeFor(
  scope: 'page' | 'loader' | 'action',
  projectId: string | undefined
): Outcome | undefined {
  const project = projectId ? getProjectBySlug(projectId) : null;
  if (!project?.archived) return undefined;
  if (scope === 'page') return render(ArchivedProjectNotice);
  return deny(
    scope === 'loader' ? 410 : 403,
    'This project is archived and read-only.'
  );
}

// Declared as `use` on the /demo/projects/:projectId route node, so it runs for
// the page render, every loader RPC, and every route-bound action under that
// node. Every scope now carries a location (action optionally, for route-bound
// actions), so the gate reads pathParams uniformly.
export const archivedGateServer = defineServerMiddleware(async (ctx, next) => {
  const outcome = archivedOutcomeFor(
    ctx.scope,
    ctx.location?.pathParams.projectId
  );
  if (outcome) return outcome;
  await next();
});

export const archivedGate = [archivedGateServer];
