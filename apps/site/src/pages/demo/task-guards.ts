import { deny } from 'hono-preact';
import { getTask } from '../../demo/data.js';

// Only the author or the assignee may move a task to Done.
export async function assertCanMoveToDone(
  taskId: string,
  userId: string | undefined
): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw deny(404, 'Task not found');
  if (!userId || (userId !== task.authorId && userId !== task.assigneeId)) {
    throw deny(403, 'Only the author or assignee can move a task to Done.');
  }
}
