// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createCaller, publish } from 'hono-preact';
import { serverLoaders } from '../projects-shell.server.js';
import {
  activityChannel,
  taskMovedEvent,
} from '../../../demo/activity-stream.js';
import { resetDemoData, getTask } from '../../../demo/data.js';
import { __resetSimHeartbeatForTesting } from '../../../demo/activity-sim.js';

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
