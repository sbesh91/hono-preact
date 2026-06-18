import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoData, listAllTasks, getProject, getTask } from '../data.js';
import { __resetActivityForTesting } from '../activity-stream.js';
import { simulateActivity } from '../activity-sim.js';

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
