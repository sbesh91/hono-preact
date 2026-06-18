import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoData, getTask } from '../data.js';
import {
  publishActivity,
  subscribeActivity,
  taskMovedEvent,
  commentAddedEvent,
  taskCreatedEvent,
  recentActivityEvents,
  __resetActivityForTesting,
  type ActivityEvent,
} from '../activity-stream.js';

beforeEach(() => {
  resetDemoData();
  __resetActivityForTesting();
});

describe('activity bus', () => {
  it('delivers published events to subscribers', () => {
    const seen: ActivityEvent[] = [];
    const unsub = subscribeActivity((e) => seen.push(e));
    const task = getTask('t-1')!;
    publishActivity(taskMovedEvent(task, 'done', 'Alice'));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: 'task-moved',
      taskId: 't-1',
      to: 'done',
      actor: 'Alice',
      projectSlug: 'inf',
      simulated: false,
    });
    unsub();
    publishActivity(commentAddedEvent(task, 'Bob'));
    expect(seen).toHaveLength(1); // unsubscribed: no further delivery
  });

  it('assigns unique ids and marks simulated events', () => {
    const task = getTask('t-1')!;
    const a = taskCreatedEvent(task, 'Alice');
    const b = commentAddedEvent(task, 'Bob', true);
    expect(a.id).not.toBe(b.id);
    expect(a.simulated).toBe(false);
    expect(b.simulated).toBe(true);
  });

  it('isolates a throwing subscriber so others still receive the event', () => {
    const seen: ActivityEvent[] = [];
    subscribeActivity(() => {
      throw new Error('boom');
    });
    subscribeActivity((e) => seen.push(e));
    const task = getTask('t-1')!;
    expect(() =>
      publishActivity(taskMovedEvent(task, 'done', 'Alice'))
    ).not.toThrow();
    expect(seen).toHaveLength(1);
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
