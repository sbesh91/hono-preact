import { defineAction, defineLoader, type LoaderCtx } from 'hono-preact';
import {
  getProjectBySlug,
  listIssuesForProject,
  createIssue,
  type Issue,
  type Project,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';
import { requireSession } from '../../demo/guard.js';

export const pageUse = requireSession;

type Row = {
  project: Project;
  issues: Issue[];
};

const issuesLoader = async (ctx: LoaderCtx): Promise<Row | null> => {
  const slug = ctx.location.pathParams.projectId;
  if (!slug) return null;
  const project = getProjectBySlug(slug);
  if (!project) return null;
  return { project, issues: listIssuesForProject(project.id) };
};

export const serverLoaders = {
  default: defineLoader(issuesLoader),
};

export const serverActions = {
  createIssue: defineAction<
    { projectId: string; title: string; body: string },
    { id: string }
  >(async (ctx, input) => {
    const user = await currentUser(ctx.c);
    if (!user) throw new Error('not signed in');
    const created = createIssue(user, {
      projectId: input.projectId,
      title: input.title.trim(),
      body: input.body.trim(),
    });
    return { id: created.id };
  }),
};
