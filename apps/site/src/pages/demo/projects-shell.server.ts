import { defineLoader, type LoaderCtx } from 'hono-preact';
import {
  listProjects,
  listTasksForProject,
  type Project,
  type User,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';

export type ShellData = {
  user: User | null;
  projects: (Project & { taskCount: number })[];
};

const shellLoader = async (ctx: LoaderCtx): Promise<ShellData> => {
  const user = await currentUser(ctx.c);
  const projects = listProjects().map((p) => ({
    ...p,
    taskCount: listTasksForProject(p.id).length,
  }));
  return { user, projects };
};

export const serverLoaders = {
  default: defineLoader(shellLoader),
};
