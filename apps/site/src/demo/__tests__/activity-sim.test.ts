import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventStream } from 'hono-preact';
import { resetDemoData, listAllTasks, getProject, getTask } from '../data.js';
import {
  __resetActivityForTesting,
  activityChannel,
} from '../activity-stream.js';
import {
  simulateActivity,
  acquireSimHeartbeat,
  __resetSimHeartbeatForTesting,
} from '../activity-sim.js';

beforeEach(() => {
  resetDemoData();
  __resetActivityForTesting();
});

describe('simulateActivity', () => {
  it('produces a valid display-only event referencing a real task, 200 runs', () => {
    const ids = new Set(listAllTasks().map((t) => t.id));
    const statusBefore = new Map(listAllTasks().map((t) => [t.id, t.status]));

    for (let i = 0; i < 200; i++) {
      const e = simulateActivity();
      expect(e).not.toBeNull();
      if (!e) continue;
      expect(['task-moved', 'comment-added']).toContain(e.kind);
      expect(ids.has(e.taskId)).toBe(true);
      const task = getTask(e.taskId)!;
      expect(e.projectSlug).toBe(getProject(task.projectId)!.slug);
      expect(e.simulated).toBe(true);
      if (e.kind === 'task-moved') {
        expect(e.to).not.toBe(task.status); // moved somewhere new
      }
    }

    // Display-only: the store is untouched.
    for (const t of listAllTasks()) {
      expect(t.status).toBe(statusBefore.get(t.id));
    }
  });
});

describe('sim heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    __resetSimHeartbeatForTesting();
    vi.useRealTimers();
  });

  it('publishes a simulated event on the channel while held', async () => {
    const ac = new AbortController();
    const gen = eventStream(activityChannel.key(), ac.signal);
    const release = acquireSimHeartbeat();
    const first = gen.next();
    // The tick window is 4000-8000ms; 8000 guarantees one fire.
    await vi.advanceTimersByTimeAsync(8000);
    const got = await first;
    expect(got.done).toBe(false);
    expect(got.value).toMatchObject({ simulated: true });
    release();
    ac.abort();
  });

  it('is refcounted: the timer stops only when the last holder releases', () => {
    const releaseA = acquireSimHeartbeat();
    const releaseB = acquireSimHeartbeat();
    expect(vi.getTimerCount()).toBe(1);
    releaseA();
    expect(vi.getTimerCount()).toBe(1);
    releaseB();
    expect(vi.getTimerCount()).toBe(0);
    // A release is idempotent: calling it again must not go negative.
    releaseB();
    expect(vi.getTimerCount()).toBe(0);
  });
});
