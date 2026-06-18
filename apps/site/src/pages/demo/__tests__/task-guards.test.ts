import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDemoData,
  listTasksForProject,
  getProjectBySlug,
} from '../../../demo/data.js';
import { assertCanMoveToDone } from '../task-guards.js';

beforeEach(() => resetDemoData());

describe('assertCanMoveToDone', () => {
  it('allows the author', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find((t) => t.status !== 'done')!;
    await expect(
      assertCanMoveToDone(task.id, task.authorId)
    ).resolves.toBeUndefined();
  });

  it('rejects a non-author non-assignee', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find(
      (t) => t.assigneeId === null && t.status !== 'done'
    )!;
    await expect(assertCanMoveToDone(task.id, 'u-999')).rejects.toThrow();
  });
});
