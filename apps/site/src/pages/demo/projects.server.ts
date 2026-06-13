import { defineLoader, type LoaderCtx } from 'hono-preact';
import { listProjects, listIssuesForProject } from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';

const projectsLoader = async (ctx: LoaderCtx) => {
  const user = await currentUser(ctx.c);
  const projects = listProjects().map((p) => {
    const issues = listIssuesForProject(p.id);
    return {
      ...p,
      openCount: issues.filter((i) => i.status === 'open').length,
      totalCount: issues.length,
    };
  });
  return { user, projects };
};

export const serverLoaders = {
  default: defineLoader(projectsLoader),
};
