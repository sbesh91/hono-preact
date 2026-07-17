import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createCaller, isDeny, type CallResult } from 'hono-preact';
import { serverLoaders, type BoardData } from '../project-board.server.js';
import { resetDemoData } from '../../../demo/data.js';

const callBoard = async (projectId: string): Promise<CallResult<BoardData>> => {
  const app = new Hono();
  let result!: CallResult<BoardData>;
  app.get('/', async (c) => {
    result = await createCaller(c).call(serverLoaders.default, {
      location: { pathParams: { projectId } },
    });
    return c.text('ok');
  });
  await app.request('/');
  return result;
};

describe('project board loader', () => {
  beforeEach(() => resetDemoData());

  it('loads a known project with its tasks and users', async () => {
    const r = await callBoard('inf');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.project.slug).toBe('inf');
      expect(r.value.tasks.length).toBeGreaterThan(0);
    }
  });

  it('denies 404 for a well-formed unknown slug', async () => {
    const r = await callBoard('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
    }
  });

  it('rejects a malformed slug via paramsSchema (framework 404)', async () => {
    const r = await callBoard('NOT A SLUG');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(404);
    }
  });
});

const callBoardWith = async (
  projectId: string,
  searchParams: Record<string, string>
): Promise<CallResult<BoardData>> => {
  const app = new Hono();
  let result!: CallResult<BoardData>;
  app.get('/', async (c) => {
    result = await createCaller(c).call(serverLoaders.default, {
      location: { pathParams: { projectId }, searchParams },
    });
    return c.text('ok');
  });
  await app.request('/');
  return result;
};

describe('project board priority filter', () => {
  beforeEach(() => resetDemoData());

  it('defaults to all tasks with priority "all"', async () => {
    const r = await callBoard('inf');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.priority).toBe('all');
      expect(r.value.tasks.length).toBe(r.value.totalCount);
    }
  });

  it('filters tasks server-side by ?priority=', async () => {
    const r = await callBoardWith('inf', { priority: 'urgent' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.priority).toBe('urgent');
      expect(r.value.tasks.length).toBeGreaterThan(0);
      expect(r.value.tasks.every((t) => t.priority === 'urgent')).toBe(true);
      expect(r.value.totalCount).toBeGreaterThan(r.value.tasks.length);
    }
  });

  it('rejects an unknown priority via searchSchema (framework 400)', async () => {
    const r = await callBoardWith('inf', { priority: 'bogus' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isDeny(r.outcome)).toBe(true);
      if (isDeny(r.outcome)) expect(r.outcome.status).toBe(400);
    }
  });
});
