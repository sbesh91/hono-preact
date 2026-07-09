import { describe, it, expect, beforeEach } from 'vitest';
import { publish, eventStream } from 'hono-preact';
import { resetDemoData, getTask } from '../data.js';
import {
  activityChannel,
  taskMovedEvent,
  commentAddedEvent,
  taskCreatedEvent,
  recentActivityEvents,
  __resetActivityForTesting,
} from '../activity-stream.js';

beforeEach(() => {
  resetDemoData();
  __resetActivityForTesting();
});

describe('activity channel', () => {
  it('delivers published events to a channel subscriber', async () => {
    const ac = new AbortController();
    const gen = eventStream(activityChannel.key(), ac.signal);
    const first = gen.next();
    const task = getTask('t-1')!;
    publish(activityChannel.key(), taskMovedEvent(task, 'done', 'Alice'));
    const got = await first;
    expect(got.done).toBe(false);
    expect(got.value).toMatchObject({
      kind: 'task-moved',
      taskId: 't-1',
      to: 'done',
      actor: 'Alice',
      projectSlug: 'inf',
      simulated: false,
    });
    ac.abort();
  });

  it('assigns unique ids and marks simulated events', () => {
    const task = getTask('t-1')!;
    const a = taskCreatedEvent(task, 'Alice');
    const b = commentAddedEvent(task, 'Bob', true);
    expect(a.id).not.toBe(b.id);
    expect(a.simulated).toBe(false);
    expect(b.simulated).toBe(true);
  });
});

describe('recentActivityEvents', () => {
  it('returns up to `limit` well-formed events newest-first from the seed store', () => {
    const events = recentActivityEvents(5);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].at).toBeGreaterThanOrEqual(events[i].at);
    }
    for (const e of events) {
      expect(typeof e.taskTitle).toBe('string');
      expect(['inf', 'api', 'web']).toContain(e.projectSlug);
      expect(e.simulated).toBe(false);
    }
  });
});
