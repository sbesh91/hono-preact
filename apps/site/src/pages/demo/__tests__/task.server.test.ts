import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  createCaller,
  isDeny,
  type CallResult,
  type InferActionPayload,
  type InferActionResult,
} from 'hono-preact';
import {
  serverActions,
  serverLoaders,
  type TaskDetail,
} from '../task.server.js';
import { draftPreviewHandler } from '../../../demo/draft-preview.js';
import {
  resetDemoData,
  upsertUser,
  listTasksForProject,
  getProjectBySlug,
  getTask,
} from '../../../demo/data.js';
import { signIn } from '../../../demo/session.js';

type SetStatusInput = InferActionPayload<typeof serverActions.setStatus>;
type SetStatusResult = InferActionResult<typeof serverActions.setStatus>;

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

// Run setStatus through createCaller inside a real Hono request so currentUser
// can read the signed session cookie. `signedInAs` mints + replays the cookie.
async function runSetStatus(
  input: SetStatusInput,
  signedInAs?: { id: string; email: string; name: string }
): Promise<CallResult<SetStatusResult>> {
  const cookie = signedInAs ? await mintSessionCookie(signedInAs) : null;
  const app = new Hono();
  let result!: CallResult<SetStatusResult>;
  app.post('/', async (c) => {
    result = await createCaller(c).call(serverActions.setStatus, input);
    return c.text('ok');
  });
  const res = await app.request('/', {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  });
  expect(res.status).toBe(200);
  return result;
}

describe('task setStatus action', () => {
  beforeEach(() => resetDemoData());

  it('moves a task to a non-Done status without an author check', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find((t) => t.status !== 'done')!;

    const r = await runSetStatus({ taskId: task.id, status: 'in_review' });

    expect(r.ok).toBe(true);
    expect(getTask(task.id)?.status).toBe('in_review');
  });

  it('denies moving to Done for a non-author non-assignee', async () => {
    const stranger = upsertUser('stranger@example.com', 'Stranger');
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id).find(
      (t) => t.assigneeId === null && t.status !== 'done'
    )!;

    const r = await runSetStatus({ taskId: task.id, status: 'done' }, stranger);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) {
        expect(r.outcome.status).toBe(403);
        expect(r.outcome.message).toMatch(/author|assignee/i);
      }
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

    const r = await runSetStatus({ taskId: task.id, status: 'done' }, author);

    expect(r.ok).toBe(true);
    expect(getTask(task.id)?.status).toBe('done');
  });
});

// The detail hero mirrors the board card (assignee avatar included), so the task
// loader must resolve the assignee User, not just the author.
describe('task loader', () => {
  beforeEach(() => resetDemoData());

  const callTask = async (pathParams: {
    projectId: string;
    taskId: string;
  }): Promise<CallResult<TaskDetail>> => {
    const app = new Hono();
    let result!: CallResult<TaskDetail>;
    app.get('/', async (c) => {
      result = await createCaller(c).call(serverLoaders.task, {
        location: { pathParams },
      });
      return c.text('ok');
    });
    await app.request('/');
    return result;
  };

  const loadTask = async (taskId: string): Promise<TaskDetail> => {
    const result = await callTask({ projectId: 'inf', taskId });
    if (!result.ok) throw new Error('expected the task loader to succeed');
    return result.value;
  };

  it('resolves the assignee User alongside the author', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id)[0];
    const assignee = upsertUser('assignee@example.com', 'Assignee');
    task.assigneeId = assignee.id;

    const result = await loadTask(task.id);

    expect(result.assignee?.id).toBe(assignee.id);
    expect(result.assignee?.name).toBe('Assignee');
    // The author is still resolved on the same value.
    expect(result.author?.id).toBe(task.authorId);
  });

  it('resolves a null assignee for an unassigned task', async () => {
    const inf = getProjectBySlug('inf')!;
    const task = listTasksForProject(inf.id)[0];
    task.assigneeId = null;

    const result = await loadTask(task.id);

    expect(result.assignee).toBeNull();
  });

  it('denies 404 for a well-formed unknown task id', async () => {
    const r = await callTask({ projectId: 'inf', taskId: 't-999999' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
    }
  });

  it('rejects a malformed task id via paramsSchema (framework 404)', async () => {
    const r = await callTask({ projectId: 'inf', taskId: 'DROP TABLE' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
    }
  });
});

// The comments loader is streaming (an async generator), so it is called
// like projects-shell.server.test.ts's activity loader: paramsSchema
// coercion runs when the generator is PRODUCED, before any chunk is drawn,
// so a malformed id denies before iteration rather than mid-stream.
describe('comments loader (streaming)', () => {
  beforeEach(() => resetDemoData());

  const callComments = async (pathParams: {
    projectId: string;
    taskId: string;
  }): Promise<CallResult<unknown>> => {
    const app = new Hono();
    let result!: CallResult<unknown>;
    app.get('/', async (c) => {
      result = await createCaller(c).call(serverLoaders.comments, {
        location: { pathParams },
      });
      return c.text('ok');
    });
    await app.request('/');
    return result;
  };

  it('rejects a malformed task id via paramsSchema (framework 404)', async () => {
    const r = await callComments({ projectId: 'inf', taskId: 'DROP TABLE' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
    }
  });
});

// The draft-preview socket is a route-bound duplex socket: the handler only
// touches its own connection, so it is testable by driving the def's
// lifecycle methods directly with a stub ServerSocket.
describe('draftPreview socket', () => {
  beforeEach(() => resetDemoData());

  type Sent = { chars: number; words: number; mentions: string[] };
  const makeSocket = () => {
    const sent: Sent[] = [];
    return {
      sent,
      socket: {
        send: (msg: Sent) => {
          sent.push(msg);
        },
        close: () => {},
        data: undefined,
        raw: null,
      },
    };
  };

  it('sends a zero preview on open', async () => {
    const { socket, sent } = makeSocket();
    await draftPreviewHandler.open?.(socket);
    expect(sent).toEqual([{ chars: 0, words: 0, mentions: [] }]);
  });

  it('answers each draft message with its preview', async () => {
    const { socket, sent } = makeSocket();
    await draftPreviewHandler.message?.(socket, {
      draft: 'ask @bob to review',
    });
    expect(sent).toEqual([{ chars: 18, words: 4, mentions: ['Bob'] }]);
  });
});
