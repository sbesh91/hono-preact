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
