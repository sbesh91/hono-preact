import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { isDeny } from 'hono-preact';
import type { LoaderCtx } from 'hono-preact';
import {
  serverActions,
  serverLoaders,
  type TaskDetail,
} from '../task.server.js';
import {
  resetDemoData,
  upsertUser,
  listTasksForProject,
  getProjectBySlug,
  getTask,
} from '../../../demo/data.js';
import { signIn } from '../../../demo/session.js';

// defineAction returns the handler function as-is (no wrapper object), so
// serverActions.setStatus IS the ActionFn; we cast and call it directly.
// The full page-action wire is integration-tested in packages/server; here
// we only check the setStatus handler's behavior and its Done guard.
type ActionFn = (
  ctx: { c: unknown; signal: AbortSignal },
  input: { taskId: string; status: string }
) => Promise<unknown>;
const setStatus = serverActions.setStatus as unknown as ActionFn;

// A cookie set on the response is not readable on the same request, so the
// session cookie is minted in a first round-trip and replayed as a request
// header on the action call (currentUser reads it off c.req).
async function mintSessionCookie(user: {
  id: string;
  email: string;
  name: string;
}): Promise<string> {
  const app = new Hono();
  app.post('/login', async (c) => {
    await signIn(c, user);
    return c.text('ok');
  });
  const res = await app.request('/login', { method: 'POST' });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('expected a session cookie');
  // Strip attributes (Path, HttpOnly, ...); keep just `name=value`.
  return setCookie.split(';')[0];
}

// Run setStatus inside a real Hono request so currentUser can read the signed
// session cookie. `signedInAs` mints + replays the cookie before the action.
async function runSetStatus(
  input: { taskId: string; status: string },
  signedInAs?: { id: string; email: string; name: string }
): Promise<{ status: number; error: unknown }> {
  const cookie = signedInAs ? await mintSessionCookie(signedInAs) : null;
  const app = new Hono();
  let error: unknown = null;
  app.post('/', async (c) => {
    try {
      await setStatus({ c, signal: new AbortController().signal }, input);
    } catch (e) {
      error = e;
    }
    return c.text('ok');
  });
  const res = await app.request('/', {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { status: res.status, error };
}

describe('task setStatus action', () => {
  beforeEach(() => resetDemoData());

  it('moves a task to a non-Done status without an author check', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find((t) => t.status !== 'done')!;

    const { error } = await runSetStatus({
      taskId: task.id,
      status: 'in_review',
    });

    expect(error).toBe(null);
    expect(getTask(task.id)?.status).toBe('in_review');
  });

  it('denies moving to Done for a non-author non-assignee', async () => {
    const stranger = upsertUser('stranger@example.com', 'Stranger');
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find(
      (t) => t.assigneeId === null && t.status !== 'done'
    )!;

    const { error } = await runSetStatus(
      { taskId: task.id, status: 'done' },
      stranger
    );

    expect(isDeny(error)).toBe(true);
    if (isDeny(error)) {
      expect(error.status).toBe(403);
      expect(error.message).toMatch(/author|assignee/i);
    }
    // The deny short-circuits before the write, so status is unchanged.
    expect(getTask(task.id)?.status).not.toBe('done');
  });

  it('allows the author to move a task to Done', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find((t) => t.status !== 'done')!;
    const author = upsertUser('author@example.com', 'Author');
    // Re-seed authorId so the signed-in user is the author of this task.
    task.authorId = author.id;

    const { error } = await runSetStatus(
      { taskId: task.id, status: 'done' },
      author
    );

    expect(error).toBe(null);
    expect(getTask(task.id)?.status).toBe('done');
  });
});

// The detail hero mirrors the board card (assignee avatar included), so the task
// loader must resolve the assignee User, not just the author.
describe('task loader', () => {
  beforeEach(() => resetDemoData());

  const loadTask = (taskId: string): Promise<TaskDetail | null> => {
    const ctx = {
      c: {},
      location: { path: '/', pathParams: { taskId }, searchParams: {} },
      signal: new AbortController().signal,
    } as unknown as LoaderCtx;
    const fn = serverLoaders.task.fn as (
      ctx: LoaderCtx
    ) => Promise<TaskDetail | null>;
    return fn(ctx);
  };

  it('resolves the assignee User alongside the author', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id)[0];
    const assignee = upsertUser('assignee@example.com', 'Assignee');
    task.assigneeId = assignee.id;

    const result = await loadTask(task.id);

    expect(result?.assignee?.id).toBe(assignee.id);
    expect(result?.assignee?.name).toBe('Assignee');
    // The author is still resolved on the same value.
    expect(result?.author?.id).toBe(task.authorId);
  });

  it('resolves a null assignee for an unassigned task', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id)[0];
    task.assigneeId = null;

    const result = await loadTask(task.id);

    expect(result?.assignee).toBeNull();
  });

  it('returns null for an unknown task id', async () => {
    expect(await loadTask('does-not-exist')).toBeNull();
  });
});
