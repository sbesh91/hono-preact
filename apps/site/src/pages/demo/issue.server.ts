import {
  defineAction,
  defineLoader,
  type LoaderCtx,
} from 'hono-preact';
import {
  activityForProject,
  addComment,
  getIssue,
  getUser,
  listComments,
  setIssueStatus,
  type Comment,
  type Issue,
  type IssueStatus,
  type User,
  type ActivityItem,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';
import { assertCanClose } from './issue-guards.js';

type WithAuthor<T extends { authorId: string }> = T & { author: User | null };
const withAuthor = <T extends { authorId: string }>(x: T): WithAuthor<T> => ({
  ...x,
  author: getUser(x.authorId),
});

const issueLoader = async (
  ctx: LoaderCtx
): Promise<WithAuthor<Issue> | null> => {
  const id = ctx.location.pathParams.issueId;
  if (!id) return null;
  const issue = getIssue(id);
  return issue ? withAuthor(issue) : null;
};

const commentsLoader = async function* (
  ctx: LoaderCtx
): AsyncGenerator<WithAuthor<Comment>[]> {
  const id = ctx.location.pathParams.issueId;
  if (!id) {
    yield [];
    return;
  }
  const all = listComments(id).map(withAuthor);
  // Demo throttle: trickle comments one at a time. Removes any feeling of
  // "wait for the whole loader" and is the visible proof of streaming.
  const cumulative: WithAuthor<Comment>[] = [];
  for (const c of all) {
    if (ctx.signal.aborted) return;
    cumulative.push(c);
    yield cumulative;
    await new Promise((r) => setTimeout(r, 300));
  }
  // Final yield to flush state when there are zero comments.
  if (cumulative.length === 0) yield [];
};

const activityLoader = async (
  ctx: LoaderCtx
): Promise<ActivityItem[]> => {
  const issueId = ctx.location.pathParams.issueId;
  const issue = issueId ? getIssue(issueId) : null;
  if (!issue) return [];
  return activityForProject(issue.projectId, 10);
};

export const serverLoaders = {
  issue: defineLoader(issueLoader),
  comments: defineLoader(commentsLoader),
  activity: defineLoader(activityLoader),
};

export const serverActions = {
  addComment: defineAction<
    { issueId: string; body: string },
    { id: string }
  >(async (ctx, input) => {
    const user = await currentUser(ctx.c);
    if (!user) throw new Error('not signed in');
    const c = addComment(user, {
      issueId: input.issueId,
      body: input.body.trim(),
    });
    return { id: c.id };
  }),

  setStatus: defineAction<
    { issueId: string; status: IssueStatus },
    { ok: true }
  >(async (ctx, input) => {
    const user = await currentUser(ctx.c);
    if (input.status === 'closed') {
      await assertCanClose(input.issueId, user?.id);
    }
    setIssueStatus(input.issueId, input.status);
    return { ok: true };
  }),
};
