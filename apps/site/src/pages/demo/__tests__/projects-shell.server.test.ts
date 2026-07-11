// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createCaller, publish, serverRoute, buildPath } from 'hono-preact';
import { serverLoaders } from '../projects-shell.server.js';
import {
  activityChannel,
  taskMovedEvent,
} from '../../../demo/activity-stream.js';
import { resetDemoData, getTask } from '../../../demo/data.js';
import { __resetSimHeartbeatForTesting } from '../../../demo/activity-sim.js';
import routes from '../../../routes.js';
import { requireSession } from '../../../demo/guard.js';

// Mint a real Hono Context by driving one request through a capture handler.
async function mintContext(): Promise<Context> {
  const app = new Hono();
  let captured!: Context;
  app.get('*', (c) => {
    captured = c;
    return c.text('ok');
  });
  await app.request('http://localhost/');
  return captured;
}

// Resolves true if `p` is still pending after a few microtask ticks (long
// enough for the generator's synchronous backfill yields to settle).
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol();
  const ticks = Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => marker);
  const result = await Promise.race([p.then(() => false), ticks]);
  return result === marker;
}

beforeEach(() => resetDemoData());
afterEach(() => {
  __resetSimHeartbeatForTesting();
  vi.restoreAllMocks();
});

describe('activity live loader', () => {
  it('backfills recent events, streams a published event, and cleans up on abort', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const c = await mintContext();
    const ctrl = new AbortController();
    const r = await createCaller(c).call(serverLoaders.activity, {
      signal: ctrl.signal,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Drain the synchronous backfill until the stream parks on the channel.
    const backfill: unknown[] = [];
    let parked: Promise<IteratorResult<unknown>> | null = null;
    for (let i = 0; i < 12; i++) {
      const np = r.value.next();
      if (await isPending(np)) {
        parked = np;
        break;
      }
      const step = await np;
      expect(step.done).toBe(false);
      backfill.push(step.value);
    }
    expect(parked).not.toBeNull();
    expect(backfill.length).toBeGreaterThan(0);
    expect(backfill.length).toBeLessThanOrEqual(5);

    // A publish on the activity channel arrives as the next chunk. Give the
    // parked resumption a macrotask to register its subscription first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const task = getTask('t-1')!;
    publish(activityChannel.key(), taskMovedEvent(task, 'done', 'Alice'));
    const live = await parked!;
    expect(live.done).toBe(false);
    expect(live.value).toMatchObject({ kind: 'task-moved', taskId: 't-1' });

    // Abort ends the stream; the finally releases the sim heartbeat timer.
    const end = r.value.next();
    ctrl.abort();
    expect((await end).done).toBe(true);
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('shell loaders are subtree-bound to the projects layout', () => {
  it('binds default and activity to /demo/projects/*', () => {
    // Route binding is what attaches the layout's own composed use chain
    // (requireSession on the projects node) to these loaders' RPCs.
    expect(serverLoaders.default.__routeId).toBe('/demo/projects/*');
    expect(serverLoaders.default.__routeBound).toBe(true);
    expect(serverLoaders.activity.__routeId).toBe('/demo/projects/*');
    expect(serverLoaders.activity.__routeBound).toBe(true);
  });

  it('default loader returns the shell data shape via the server caller', async () => {
    const c = await mintContext();
    const r = await createCaller(c).call(serverLoaders.default);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.user).toBeNull();
    expect(r.value.projects.length).toBeGreaterThan(0);
    for (const p of r.value.projects) {
      expect(typeof p.taskCount).toBe('number');
    }
  });
});

describe('the bound subtree pattern resolves the projects gates from the site manifest', () => {
  it('the bound pattern is a routeUse key carrying exactly the layout chain', () => {
    const byPattern = new Map(routes.routeUse.map((r) => [r.path, r.use]));
    // The seam the RPC guard resolution walks: declared pattern -> routeUse
    // key -> the projects layout's own composed chain (requireSession).
    expect(byPattern.get(serverLoaders.default.__routeId!)).toEqual(
      requireSession
    );
  });
});

// Type-level pins, enforced by `pnpm typecheck` (the site tsconfig includes
// test files). Never executed.
function _subtreeTypeProbes() {
  // The subtree spelling is typed for the projects layout.
  serverRoute('/demo/projects/*');
  // @ts-expect-error a leaf path derives no subtree pattern
  serverRoute('/demo/login/*');
  // @ts-expect-error the nav surface stays on exact registered paths
  buildPath('/demo/projects/*');
}
void _subtreeTypeProbes;
