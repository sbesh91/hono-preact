import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDemoData,
  listProjects,
  getProjectBySlug,
  listIssuesForProject,
  getIssue,
  listComments,
  createIssue,
  addComment,
  setIssueStatus,
  type User,
} from '../data.js';

const alice: User = { id: 'u-1', email: 'alice@example.com', name: 'Alice' };

describe('demo data', () => {
  beforeEach(() => resetDemoData());

  it('seeds three projects with stable slugs', () => {
    const projects = listProjects();
    expect(projects).toHaveLength(3);
    expect(projects.map((p) => p.slug)).toEqual(['inf', 'api', 'web']);
  });

  it('seeds open issues per project', () => {
    const inf = getProjectBySlug('inf')!;
    const issues = listIssuesForProject(inf.id);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.projectId === inf.id)).toBe(true);
  });

  it('createIssue adds a new open issue authored by the caller', () => {
    const inf = getProjectBySlug('inf')!;
    const created = createIssue(alice, {
      projectId: inf.id,
      title: 'My issue',
      body: 'A bug.',
    });
    expect(created.status).toBe('open');
    expect(created.authorId).toBe(alice.id);
    expect(listIssuesForProject(inf.id)).toContainEqual(created);
  });

  it('addComment appends to an issue and listComments returns in order', () => {
    // 'web' has a single seeded issue (i-5) with no seeded comments, so the
    // test isn't entangled with the i-1/i-2 streaming-demo seed thread.
    const web = getProjectBySlug('web')!;
    const issue = listIssuesForProject(web.id)[0];
    expect(listComments(issue.id)).toEqual([]); // pre-condition
    const c1 = addComment(alice, { issueId: issue.id, body: 'first' });
    const c2 = addComment(alice, { issueId: issue.id, body: 'second' });
    const comments = listComments(issue.id);
    expect(comments.map((c) => c.id)).toEqual([c1.id, c2.id]);
  });

  it('setIssueStatus updates status', () => {
    const inf = getProjectBySlug('inf')!;
    const issue = listIssuesForProject(inf.id)[0];
    setIssueStatus(issue.id, 'closed');
    expect(getIssue(issue.id)?.status).toBe('closed');
  });

  it('getIssue returns null for unknown id', () => {
    expect(getIssue('not-a-real-id')).toBe(null);
  });
});
