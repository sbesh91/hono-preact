import { describe, it, expect } from 'vitest';
import { groupTasks, STATUS_COLUMNS } from '../group-tasks.js';
import type { Task } from '../data.js';

const t = (
  id: string,
  status: Task['status'],
  priority: Task['priority']
): Task => ({
  id,
  projectId: 'p-1',
  authorId: 'u-1',
  assigneeId: null,
  title: id,
  body: '',
  status,
  priority,
  createdAt: 0,
});

describe('groupTasks', () => {
  it('returns the four status columns in fixed order', () => {
    const cols = groupTasks([]);
    expect(cols.map((c) => c.status)).toEqual(
      STATUS_COLUMNS.map((c) => c.status)
    );
  });

  it('places tasks in their status column', () => {
    const cols = groupTasks([t('a', 'backlog', 'low'), t('b', 'done', 'low')]);
    const byStatus = Object.fromEntries(
      cols.map((c) => [c.status, c.tasks.map((x) => x.id)])
    );
    expect(byStatus['backlog']).toEqual(['a']);
    expect(byStatus['done']).toEqual(['b']);
  });

  it('sorts within a column by priority (urgent first)', () => {
    const cols = groupTasks([
      t('low', 'backlog', 'low'),
      t('urgent', 'backlog', 'urgent'),
      t('med', 'backlog', 'medium'),
      t('high', 'backlog', 'high'),
    ]);
    const backlog = cols.find((c) => c.status === 'backlog')!;
    expect(backlog.tasks.map((x) => x.id)).toEqual([
      'urgent',
      'high',
      'med',
      'low',
    ]);
  });
});
