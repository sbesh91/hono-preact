import { describe, it, expect, beforeEach } from 'vitest';
import { isDeny, isRender } from 'hono-preact/page';
import { archivedGateServer, archivedOutcomeFor } from '../archived-gate.js';
import { resetDemoData, getProjectBySlug } from '../data.js';

// The gate branches on scope: page scope swaps the tree via render() (a
// page-scope-only outcome), while loader scope denies 410 and action scope
// denies 403. Route-bound actions now carry a route-authoritative location
// (#288), so the same per-resource rule covers them.
//
// A hand-built ServerCtx can't structurally satisfy Hono's Context (private
// fields make it effectively nominal, see project-board.server.ts's
// timeLoader comment for the prior instance of this), so the scope-branching
// logic is exercised through the extracted pure `archivedOutcomeFor` helper
// instead of calling `archivedGateServer.fn` with a stub ctx. The remaining
// integration surface (that the gate is really wired up as server middleware)
// is covered by the last test in this file.
describe('archivedGateServer', () => {
  beforeEach(() => resetDemoData());

  it('seeds the legacy project as archived', () => {
    expect(getProjectBySlug('legacy')?.archived).toBe(true);
    expect(getProjectBySlug('inf')?.archived).toBe(false);
  });

  it('returns a render outcome for an archived project page', () => {
    const outcome = archivedOutcomeFor('page', 'legacy');
    expect(outcome && isRender(outcome)).toBe(true);
  });

  it('denies 410 for an archived project loader RPC', () => {
    const outcome = archivedOutcomeFor('loader', 'legacy');
    expect(outcome && isDeny(outcome)).toBe(true);
    if (outcome && isDeny(outcome)) expect(outcome.status).toBe(410);
  });

  it('passes a live project through', () => {
    expect(archivedOutcomeFor('page', 'inf')).toBeUndefined();
    expect(archivedOutcomeFor('loader', 'inf')).toBeUndefined();
  });

  it('denies an action on an archived project (403)', () => {
    const outcome = archivedOutcomeFor('action', 'legacy');
    expect(outcome && isDeny(outcome)).toBe(true);
    if (outcome && isDeny(outcome)) expect(outcome.status).toBe(403);
  });

  it('passes an action on a live project through', () => {
    expect(archivedOutcomeFor('action', 'inf')).toBeUndefined();
  });

  it('is registered as server middleware', () => {
    expect(archivedGateServer.runs).toBe('server');
    expect(archivedGateServer.__kind).toBe('middleware');
  });
});
