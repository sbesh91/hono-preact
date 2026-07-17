// apps/site/src/demo/__tests__/data.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDemoData,
  getProjectBySlug,
  listTasksForProject,
  getTask,
  createTask,
  setTaskStatus,
  setTaskPriority,
  deleteTask,
  restoreTask,
  addComment,
  listComments,
  upsertUser,
  activityForProject,
} from '../data.js';

beforeEach(() => resetDemoData());

describe('tasks', () => {
  it('seeds projects with tasks across statuses and priorities', () => {
    const inf = getProjectBySlug('inf')!;
    const tasks = listTasksForProject(inf.id);
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    const statuses = new Set(tasks.map((t) => t.status));
    expect(statuses.has('backlog')).toBe(true);
    expect(statuses.has('done')).toBe(true);
    for (const t of tasks) {
      expect(['urgent', 'high', 'medium', 'low']).toContain(t.priority);
    }
  });

  it('createTask adds a task with the given status/priority/assignee', () => {
    const inf = getProjectBySlug('inf')!;
    const author = upsertUser('alice@example.com', 'Alice');
    const t = createTask(author, {
      projectId: inf.id,
      title: 'New work',
      body: 'details',
      priority: 'high',
      status: 'backlog',
      assigneeId: 'u-2',
    });
    expect(getTask(t.id)).toMatchObject({
      title: 'New work',
      priority: 'high',
      status: 'backlog',
      assigneeId: 'u-2',
      authorId: author.id,
    });
  });

  it('setTaskStatus and setTaskPriority mutate in place', () => {
    const inf = getProjectBySlug('inf')!;
    const first = listTasksForProject(inf.id)[0];
    setTaskStatus(first.id, 'done');
    setTaskPriority(first.id, 'urgent');
    expect(getTask(first.id)).toMatchObject({
      status: 'done',
      priority: 'urgent',
    });
  });

  it('deleteTask removes the task and its comments', () => {
    const inf = getProjectBySlug('inf')!;
    const first = listTasksForProject(inf.id)[0];
    const author = upsertUser('alice@example.com', 'Alice');
    addComment(author, { taskId: first.id, body: 'hi' });
    deleteTask(first.id);
    expect(getTask(first.id)).toBeNull();
    expect(listComments(first.id)).toEqual([]);
  });

  it('activity includes task-moved when a task is closed to done', () => {
    const inf = getProjectBySlug('inf')!;
    const open = listTasksForProject(inf.id).find((t) => t.status !== 'done')!;
    setTaskStatus(open.id, 'done');
    const feed = activityForProject(inf.id, 20);
    expect(feed.some((a) => a.kind === 'task-moved')).toBe(true);
  });
});

describe('deleteTask trash + restoreTask', () => {
  beforeEach(() => resetDemoData());

  it('restores a deleted task with its comments', () => {
    const before = getTask('t-1');
    expect(before).not.toBeNull();
    const commentCount = listComments('t-1').length;
    expect(commentCount).toBeGreaterThan(0);

    deleteTask('t-1');
    expect(getTask('t-1')).toBeNull();
    expect(listComments('t-1')).toHaveLength(0);

    const restored = restoreTask('t-1');
    expect(restored?.id).toBe('t-1');
    expect(getTask('t-1')?.title).toBe(before?.title);
    expect(listComments('t-1')).toHaveLength(commentCount);
  });

  it('returns null when there is nothing to restore', () => {
    expect(restoreTask('t-1')).toBeNull();
    expect(restoreTask('never-existed')).toBeNull();
  });

  it('a second restore of the same task is a no-op', () => {
    deleteTask('t-1');
    expect(restoreTask('t-1')).not.toBeNull();
    expect(restoreTask('t-1')).toBeNull();
  });
});
