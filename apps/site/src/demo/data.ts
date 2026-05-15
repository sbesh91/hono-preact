// In-memory demo store. Per-process, resets on cold start.
// No persistence; the demo is a feature showcase, not a saved tool.

export type User = { id: string; email: string; name: string };
export type Project = { id: string; slug: string; name: string };
export type IssueStatus = 'open' | 'closed';
export type Issue = {
  id: string;
  projectId: string;
  authorId: string;
  title: string;
  body: string;
  status: IssueStatus;
  createdAt: number;
};
export type Comment = {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: number;
};

type Store = {
  users: User[];
  projects: Project[];
  issues: Issue[];
  comments: Comment[];
  nextId: number;
};

let store: Store = freshStore();

function freshStore(): Store {
  const users: User[] = [
    { id: 'u-1', email: 'alice@example.com', name: 'Alice' },
    { id: 'u-2', email: 'bob@example.com', name: 'Bob' },
  ];
  const projects: Project[] = [
    { id: 'p-1', slug: 'inf', name: 'Infrastructure' },
    { id: 'p-2', slug: 'api', name: 'API' },
    { id: 'p-3', slug: 'web', name: 'Web' },
  ];
  const T = Date.UTC(2026, 4, 1); // 2026-05-01, deterministic
  const issues: Issue[] = [
    { id: 'i-1', projectId: 'p-1', authorId: 'u-1', title: 'Worker times out under load',     body: 'Repro: hammer /api/users with 200 RPS.', status: 'open',   createdAt: T },
    { id: 'i-2', projectId: 'p-1', authorId: 'u-2', title: 'Cache key collides for guests',   body: 'Anonymous sessions reuse a single key.',  status: 'open',   createdAt: T + 3600_000 },
    { id: 'i-3', projectId: 'p-2', authorId: 'u-1', title: 'Pagination cursor decodes wrong', body: 'Base64 padding mismatch.',                status: 'closed', createdAt: T + 7200_000 },
    { id: 'i-4', projectId: 'p-2', authorId: 'u-2', title: 'Add rate-limit headers',          body: 'Echo remaining budget.',                  status: 'open',   createdAt: T + 10_800_000 },
    { id: 'i-5', projectId: 'p-3', authorId: 'u-1', title: 'Dark mode toggle flashes',        body: 'SSR + client hydration mismatch.',        status: 'open',   createdAt: T + 14_400_000 },
  ];
  const comments: Comment[] = [
    { id: 'c-1', issueId: 'i-2', authorId: 'u-2', body: 'Looking at it.',           createdAt: T + 600_000 },
    { id: 'c-2', issueId: 'i-2', authorId: 'u-1', body: 'Thanks. Got a profile?',   createdAt: T + 1200_000 },
    { id: 'c-3', issueId: 'i-3', authorId: 'u-2', body: 'Fixed in #4711.',          createdAt: T + 7800_000 },
  ];
  return { users, projects, issues, comments, nextId: 100 };
}

export function resetDemoData(): void {
  store = freshStore();
}

// ---- Reads ----

export const listProjects = (): Project[] => store.projects.slice();
export const getProjectBySlug = (slug: string): Project | null =>
  store.projects.find((p) => p.slug === slug) ?? null;
export const getProject = (id: string): Project | null =>
  store.projects.find((p) => p.id === id) ?? null;

export const listIssuesForProject = (projectId: string): Issue[] =>
  store.issues
    .filter((i) => i.projectId === projectId)
    .sort((a, b) => a.createdAt - b.createdAt);

export const getIssue = (id: string): Issue | null =>
  store.issues.find((i) => i.id === id) ?? null;

export const listComments = (issueId: string): Comment[] =>
  store.comments
    .filter((c) => c.issueId === issueId)
    .sort((a, b) => a.createdAt - b.createdAt);

export const getUser = (id: string): User | null =>
  store.users.find((u) => u.id === id) ?? null;
export const findUserByEmail = (email: string): User | null =>
  store.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
export const upsertUser = (email: string, name: string): User => {
  const existing = findUserByEmail(email);
  if (existing) return existing;
  const created: User = { id: `u-${++store.nextId}`, email, name };
  store.users.push(created);
  return created;
};

// ---- Writes ----

export function createIssue(
  author: User,
  input: { projectId: string; title: string; body: string }
): Issue {
  const issue: Issue = {
    id: `i-${++store.nextId}`,
    projectId: input.projectId,
    authorId: author.id,
    title: input.title,
    body: input.body,
    status: 'open',
    createdAt: Date.now(),
  };
  store.issues.push(issue);
  return issue;
}

export function addComment(
  author: User,
  input: { issueId: string; body: string }
): Comment {
  const comment: Comment = {
    id: `c-${++store.nextId}`,
    issueId: input.issueId,
    authorId: author.id,
    body: input.body,
    createdAt: Date.now(),
  };
  store.comments.push(comment);
  return comment;
}

export function setIssueStatus(issueId: string, status: IssueStatus): void {
  const issue = store.issues.find((i) => i.id === issueId);
  if (issue) issue.status = status;
}

// ---- Activity (derived) ----

export type ActivityItem =
  | { kind: 'issue-created'; at: number; issue: Issue; user: User | null }
  | { kind: 'issue-closed'; at: number; issue: Issue; user: User | null }
  | { kind: 'comment-added'; at: number; comment: Comment; issue: Issue; user: User | null };

export function activityForProject(projectId: string, limit = 20): ActivityItem[] {
  const items: ActivityItem[] = [];
  const issues = store.issues.filter((i) => i.projectId === projectId);
  for (const issue of issues) {
    items.push({ kind: 'issue-created', at: issue.createdAt, issue, user: getUser(issue.authorId) });
    if (issue.status === 'closed') {
      items.push({ kind: 'issue-closed', at: issue.createdAt + 1, issue, user: getUser(issue.authorId) });
    }
  }
  for (const comment of store.comments) {
    const issue = store.issues.find((i) => i.id === comment.issueId);
    if (!issue || issue.projectId !== projectId) continue;
    items.push({ kind: 'comment-added', at: comment.createdAt, comment, issue, user: getUser(comment.authorId) });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}
