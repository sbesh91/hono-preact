import { ActionGuardError } from 'hono-preact';
import { getIssue } from '../../demo/data.js';

export async function assertCanClose(
  issueId: string,
  callerId: string | null | undefined
): Promise<void> {
  const issue = getIssue(issueId);
  if (!issue) throw new ActionGuardError('Issue not found', 404);
  if (!callerId || callerId !== issue.authorId) {
    throw new ActionGuardError(
      'Only the issue author can close this issue',
      403
    );
  }
}
