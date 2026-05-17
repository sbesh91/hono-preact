import { describe, it, expect, beforeEach } from 'vitest';
import { ActionGuardError } from 'hono-preact';
import {
  resetDemoData,
  upsertUser,
  listIssuesForProject,
  getProjectBySlug,
} from '../../../demo/data.js';

describe('issue actions', () => {
  beforeEach(() => resetDemoData());

  it('assertCanClose rejects when the caller is not the author', async () => {
    const stranger = upsertUser('stranger@example.com', 'Stranger');
    const inf = getProjectBySlug('inf')!;
    const issue = listIssuesForProject(inf.id)[0];

    const { assertCanClose } = await import('../issue-guards.js');
    let threw: unknown = null;
    try {
      await assertCanClose(issue.id, stranger.id);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(ActionGuardError);
    expect((threw as ActionGuardError).status).toBe(403);
  });

  it('assertCanClose passes when caller is the author', async () => {
    const inf = getProjectBySlug('inf')!;
    const issue = listIssuesForProject(inf.id)[0];

    const { assertCanClose } = await import('../issue-guards.js');
    await expect(
      assertCanClose(issue.id, issue.authorId)
    ).resolves.toBeUndefined();
  });
});
