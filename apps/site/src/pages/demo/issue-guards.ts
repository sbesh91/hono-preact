import { deny } from 'hono-preact';
import { getIssue } from '../../demo/data.js';

export async function assertCanClose(
  issueId: string,
  callerId: string | null | undefined
): Promise<void> {
  const issue = getIssue(issueId);
  if (!issue) throw deny(404, 'Issue not found');
  if (!callerId || callerId !== issue.authorId) {
    throw deny(403, 'Only the issue author can close this issue');
  }
}
